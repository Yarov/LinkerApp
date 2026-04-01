use crate::db::Database;
use crate::mikrotik::MikroTikClient;
use tauri::State;

fn gen_id() -> String {
    chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0).to_string()
}

fn get_setting(conn: &rusqlite::Connection, key: &str) -> String {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0))
        .unwrap_or_default()
}

fn make_client(conn: &rusqlite::Connection) -> MikroTikClient {
    MikroTikClient::new(
        &get_setting(conn, "mikrotik_host"),
        get_setting(conn, "mikrotik_port").parse().unwrap_or(8728),
        &get_setting(conn, "mikrotik_user"),
        &get_setting(conn, "mikrotik_password"),
    )
}

/// Read SSH credentials from DB settings, with fallback defaults for Ubiquiti devices
fn get_ssh_credentials(db_path: &std::path::Path) -> Vec<(String, String)> {
    let mut creds = Vec::new();
    if let Ok(conn) = rusqlite::Connection::open(db_path) {
        let user = get_setting(&conn, "antenna_ssh_user");
        let pass = get_setting(&conn, "antenna_ssh_password");
        if !user.is_empty() {
            creds.push((user, pass));
        }
    }
    // Fallback defaults (try in order)
    creds.push(("ubnt".to_string(), "ubnt".to_string()));
    creds.push(("admin".to_string(), String::new()));
    creds.push(("admin".to_string(), "admin".to_string()));
    creds
}

/// Discover ALL devices on the MikroTik network using ARP + DHCP + interfaces.
/// No hardcoded IPs - reads everything from the router.
#[tauri::command]
pub async fn discover_devices(db: State<'_, Database>, _subnet: Option<String>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        // Read settings and existing nodes
        let (client, known_ips) = {
            let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
            conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
            let c = make_client(&conn);
            let ips: std::collections::HashSet<String> = conn
                .prepare("SELECT ip FROM nodes WHERE ip IS NOT NULL")
                .and_then(|mut s| {
                    let r = s.query_map([], |row| row.get::<_, String>(0))?.filter_map(|r| r.ok()).collect();
                    Ok(r)
                }).unwrap_or_default();
            (c, ips)
        };

        let mut mt_conn = client.connect().map_err(|e| format!("MikroTik: {}", e))?;

        // Read router's own IPs to know which subnets exist
        let addresses = mt_conn.get_ip_addresses().unwrap_or_default();
        let arp = mt_conn.get_arp_table().unwrap_or_default();
        let dhcp = mt_conn.get_dhcp_leases().unwrap_or_default();
        let interfaces = mt_conn.get_interfaces().unwrap_or_default();

        // Collect subnets from router interfaces
        let mut subnets = Vec::new();
        for addr in &addresses {
            let ip = addr.get("address").and_then(|v| v.as_str()).unwrap_or("");
            let iface = addr.get("interface").and_then(|v| v.as_str()).unwrap_or("");
            let network = addr.get("network").and_then(|v| v.as_str()).unwrap_or("");
            if !ip.is_empty() {
                subnets.push(serde_json::json!({
                    "address": ip,
                    "interface": iface,
                    "network": network,
                }));
            }
        }

        // Collect all devices from ARP
        let mut devices = Vec::new();
        let mut seen_ips = std::collections::HashSet::new();

        for entry in &arp {
            let ip = entry.get("address").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mac = entry.get("mac-address").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let iface = entry.get("interface").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let complete = entry.get("complete").and_then(|v| v.as_str()).unwrap_or("true");
            if ip.is_empty() || seen_ips.contains(&ip) || complete == "false" { continue; }
            seen_ips.insert(ip.clone());

            // Find hostname from DHCP
            let hostname = dhcp.iter()
                .find(|d| d.get("address").and_then(|v| v.as_str()) == Some(&ip))
                .and_then(|d| d.get("host-name").and_then(|v| v.as_str()))
                .unwrap_or("").to_string();

            devices.push(serde_json::json!({
                "ip": ip,
                "mac": mac,
                "interface": iface,
                "hostname": if hostname.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(hostname) },
                "source": "arp",
                "known": known_ips.contains(&ip),
            }));
        }

        // Add DHCP-only devices not in ARP
        for entry in &dhcp {
            let ip = entry.get("address").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mac = entry.get("mac-address").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let hostname = entry.get("host-name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if ip.is_empty() || seen_ips.contains(&ip) { continue; }
            seen_ips.insert(ip.clone());

            devices.push(serde_json::json!({
                "ip": ip,
                "mac": mac,
                "interface": serde_json::Value::Null,
                "hostname": if hostname.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(hostname) },
                "source": "dhcp",
                "known": known_ips.contains(&ip),
            }));
        }

        let known_count = devices.iter().filter(|d| d["known"].as_bool() == Some(true)).count();

        println!("[Discover] {} subnets, {} devices ({} known, {} new)",
            subnets.len(), devices.len(), known_count, devices.len() - known_count);

        Ok(serde_json::json!({
            "subnets": subnets,
            "interfaces": interfaces.len(),
            "found": devices.len(),
            "known": known_count,
            "unknown": devices.len() - known_count,
            "devices": devices,
        }))
    }).await.map_err(|e| e.to_string())?
}

/// Import PPPoE profiles and secrets from MikroTik
#[tauri::command]
pub async fn import_from_mikrotik(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = {
            let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
            conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
            make_client(&conn)
        };

        let mut mt_conn = client.connect().map_err(|e| format!("MikroTik: {}", e))?;
        let profiles = mt_conn.get_pppoe_profiles().unwrap_or_default();
        let secrets = mt_conn.get_pppoe_secrets().unwrap_or_default();
        println!("[Import] Found {} profiles, {} secrets", profiles.len(), secrets.len());
        drop(mt_conn);

        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let mut plans_imported = 0;
        let mut plans_skipped = 0;
        for profile in &profiles {
            let name = profile.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name.is_empty() || name == "default" || name == "default-encryption" { continue; }
            let rate = profile.get("rate-limit").and_then(|v| v.as_str()).unwrap_or("");
            let (dl, ul) = parse_rate_limit(rate);

            let exists: bool = conn.query_row(
                "SELECT COUNT(*) > 0 FROM plans WHERE profile_name = ?1", [name], |r| r.get(0)
            ).unwrap_or(false);

            if exists { plans_skipped += 1; continue; }

            conn.execute(
                "INSERT INTO plans (id, name, download_mbps, upload_mbps, price, profile_name) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                rusqlite::params![gen_id(), name, dl, ul, name],
            ).ok();
            plans_imported += 1;
        }

        let mut clients_imported = 0;
        let mut clients_skipped = 0;
        for secret in &secrets {
            let name = secret.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let password = secret.get("password").and_then(|v| v.as_str()).unwrap_or("");
            let profile = secret.get("profile").and_then(|v| v.as_str()).unwrap_or("");
            let disabled = secret.get("disabled").and_then(|v| v.as_str()).unwrap_or("false");
            let comment = secret.get("comment").and_then(|v| v.as_str()).unwrap_or("");
            if name.is_empty() { continue; }

            let exists: bool = conn.query_row(
                "SELECT COUNT(*) > 0 FROM clients WHERE pppoe_user = ?1", [name], |r| r.get(0)
            ).unwrap_or(false);

            if exists { clients_skipped += 1; continue; }

            let status = if disabled == "true" { "SUSPENDED" } else { "ACTIVE" };
            conn.execute(
                "INSERT INTO clients (id, name, address, status, pppoe_user, pppoe_password, profile_name, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![gen_id(), name, "Importado de MikroTik", status, name, password, profile, comment],
            ).ok();
            clients_imported += 1;
        }

        conn.execute(
            "INSERT INTO network_logs (id, action, status, message) VALUES (?1, 'import', 'OK', ?2)",
            rusqlite::params![gen_id(), format!("{} planes, {} clientes importados", plans_imported, clients_imported)],
        ).ok();

        println!("[Import] {} plans, {} clients imported ({} skipped)", plans_imported, clients_imported, plans_skipped + clients_skipped);

        Ok(serde_json::json!({
            "success": true,
            "message": format!("{} planes y {} clientes importados", plans_imported, clients_imported),
            "imported": {
                "plans": plans_imported,
                "plans_skipped": plans_skipped,
                "clients": clients_imported,
                "clients_skipped": clients_skipped,
                "profiles_found": profiles.len(),
                "secrets_found": secrets.len(),
            }
        }))
    }).await.map_err(|e| e.to_string())?
}

/// Identify device manufacturer and type from MAC address
fn identify_device(mac: &str, ip: &str, hostname: &str) -> (String, String) {
    let mac_upper = mac.to_uppercase();
    let prefix = if mac_upper.len() >= 8 { &mac_upper[..8] } else { "" };

    // Known Ubiquiti MAC prefixes
    let ubiquiti_prefixes = ["F4:E2:C6", "9C:05:D6", "AC:8B:A9", "78:45:58", "80:2A:A8",
        "24:5A:4C", "74:83:C2", "B4:FB:E4", "E4:38:83", "F0:9F:C2",
        "FC:EC:DA", "E0:63:DA", "F4:92:BF", "04:18:D6", "68:72:51"];

    // TP-Link prefixes
    let tplink_prefixes = ["20:23:51", "50:C7:BF", "60:E3:27", "B0:4E:26"];

    // Cisco/Linksys
    let cisco_prefixes = ["20:AA:4B", "C4:EB:42"];

    // Samsung/phones
    let phone_prefixes = ["8A:30:3A", "A0:41:47"];

    let is_ubiquiti = ubiquiti_prefixes.iter().any(|p| mac_upper.starts_with(p));
    let is_tplink = tplink_prefixes.iter().any(|p| mac_upper.starts_with(p));
    let is_cisco = cisco_prefixes.iter().any(|p| mac_upper.starts_with(p));
    let is_phone = phone_prefixes.iter().any(|p| mac_upper.starts_with(p));

    // Determine type
    let device_type = if is_ubiquiti {
        "AP" // Could be AP or Station, default to AP
    } else if is_tplink {
        "CPE"
    } else if is_cisco {
        "ROUTER"
    } else if is_phone || hostname.contains("Galaxy") || hostname.contains("iPhone") || hostname.contains("Android") || hostname.contains("HUAWEI") {
        "CLIENT_DEVICE" // Skip these - they're end-user devices, not network nodes
    } else if ip.starts_with("192.168.0.") && (ip == "192.168.0.1" || ip.ends_with(".1")) {
        "ROUTER" // Likely ISP modem
    } else {
        "CPE"
    };

    // Generate name
    let name = if !hostname.is_empty() {
        hostname.to_string()
    } else if is_ubiquiti {
        format!("Ubiquiti ({})", &ip)
    } else if is_tplink {
        format!("TP-Link ({})", &ip)
    } else if is_cisco {
        format!("Cisco ({})", &ip)
    } else {
        format!("Dispositivo ({})", &ip)
    };

    (name, device_type.to_string())
}

fn parse_rate_limit(rate: &str) -> (i64, i64) {
    if rate.is_empty() { return (0, 0); }
    let parts: Vec<&str> = rate.split('/').collect();
    let parse_one = |s: &str| -> i64 {
        let s = s.trim();
        if s.ends_with('M') || s.ends_with('m') {
            s[..s.len()-1].parse::<f64>().unwrap_or(0.0) as i64
        } else if s.ends_with('k') || s.ends_with('K') {
            (s[..s.len()-1].parse::<f64>().unwrap_or(0.0) / 1000.0) as i64
        } else if let Ok(v) = s.parse::<f64>() {
            (v / 1_000_000.0) as i64
        } else { 0 }
    };
    match parts.len() {
        1 => { let v = parse_one(parts[0]); (v, v) }
        _ => (parse_one(parts[1]), parse_one(parts[0]))
    }
}

/// Auto-detect topology from MikroTik. Creates nodes from real network data.
/// Generic - works with any IP scheme, no hardcoded addresses.
#[tauri::command]
pub async fn auto_detect_topology(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let (client, mk_host) = {
            let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
            conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
            let c = make_client(&conn);
            let h = get_setting(&conn, "mikrotik_host");
            (c, h)
        };

        let mut mt_conn = client.connect().map_err(|e| format!("MikroTik: {}", e))?;

        // Get all network info from MikroTik
        let arp = mt_conn.get_arp_table().unwrap_or_default();
        let dhcp = mt_conn.get_dhcp_leases().unwrap_or_default();
        let addrs = mt_conn.get_ip_addresses().unwrap_or_default();
        let identity = mt_conn.get_identity().unwrap_or_else(|_| "MikroTik".to_string());

        // Collect all responsive devices
        let mut found_devices: Vec<(String, String, String)> = Vec::new(); // (ip, mac, hostname)

        for entry in &arp {
            let ip = entry.get("address").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mac = entry.get("mac-address").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let complete = entry.get("complete").and_then(|v| v.as_str()).unwrap_or("true");
            if ip.is_empty() || complete == "false" { continue; }

            let hostname = dhcp.iter()
                .find(|d| d.get("address").and_then(|v| v.as_str()) == Some(&ip))
                .and_then(|d| d.get("host-name").and_then(|v| v.as_str()))
                .unwrap_or("").to_string();

            found_devices.push((ip, mac, hostname));
        }

        drop(mt_conn);

        // Write to DB
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let node_count: i64 = conn.query_row("SELECT COUNT(*) FROM nodes", [], |r| r.get(0)).unwrap_or(0);
        let mut created = 0;

        // Always ensure router node exists
        let router_exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM nodes WHERE type = 'ROUTER'", [], |r| r.get(0)
        ).unwrap_or(false);

        let router_id = if !router_exists {
            let id = gen_id();
            conn.execute(
                "INSERT INTO nodes (id, name, type, ip, status, last_seen) VALUES (?1, ?2, 'ROUTER', ?3, 'ONLINE', datetime('now'))",
                rusqlite::params![id, identity, mk_host],
            ).ok();
            created += 1;
            println!("[Topology] Created router: {} ({})", identity, mk_host);
            id
        } else {
            // Update existing router status
            conn.execute("UPDATE nodes SET status = 'ONLINE', last_seen = datetime('now') WHERE type = 'ROUTER'", []).ok();
            conn.query_row("SELECT id FROM nodes WHERE type = 'ROUTER'", [], |r| r.get::<_, String>(0)).unwrap_or_default()
        };

        // Create nodes for discovered devices (only if DB was empty)
        if node_count == 0 {
            // Also try to get wstalist from APs via SSH for better identification
            // Read SSH credentials from DB settings, with fallback defaults
            let ssh_creds = get_ssh_credentials(&db_path);
            if let Ok(mut mt2) = client.connect() {
                // Try SSH to each Ubiquiti device to get its hostname
                for (ip, mac, hostname) in found_devices.iter_mut() {
                    let (_, dev_type) = identify_device(mac, ip, hostname);
                    if dev_type == "AP" && hostname.is_empty() {
                        // Try SSH via MikroTik with configured credentials
                        let mut got_hostname = false;
                        for (user, pass) in &ssh_creds {
                            if let Ok((output, 0)) = mt2.ssh_exec(ip, user, pass, "grep resolv.host.1.name /tmp/system.cfg") {
                                let clean = output.replace("\\n", "\n");
                                if let Some(line) = clean.lines().find(|l| l.contains("resolv.host.1.name=")) {
                                    if let Some(name) = line.split('=').nth(1) {
                                        let name = name.trim();
                                        if !name.is_empty() {
                                            *hostname = name.to_string();
                                            println!("[Topology] SSH got hostname for {}: {}", ip, name);
                                            got_hostname = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        if !got_hostname {
                            println!("[Topology] SSH failed for AP {}, using MAC-based name", ip);
                        }
                    }
                }
            }

            for (ip, mac, hostname) in &found_devices {
                let (name, dev_type) = identify_device(mac, ip, hostname);

                // Skip end-user devices (phones, laptops)
                if dev_type == "CLIENT_DEVICE" {
                    println!("[Topology] Skipping client device: {} ({})", name, ip);
                    continue;
                }

                // Skip the router's own IPs
                let is_router_ip = addrs.iter().any(|a| {
                    a.get("address").and_then(|v| v.as_str()).unwrap_or("").starts_with(&format!("{}/", ip))
                });
                if is_router_ip { continue; }

                conn.execute(
                    "INSERT OR IGNORE INTO nodes (id, name, type, ip, mac, status, parent_id, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, 'ONLINE', ?6, datetime('now'))",
                    rusqlite::params![gen_id(), name, dev_type, ip, mac, router_id],
                ).ok();
                created += 1;
                println!("[Topology] Created: {} ({}) type={} mac={}", name, ip, dev_type, mac);
            }
        } else {
            // Update existing nodes' status based on ARP
            let found_ips: std::collections::HashSet<String> = found_devices.iter().map(|(ip, _, _)| ip.clone()).collect();
            conn.execute("UPDATE nodes SET status = 'OFFLINE' WHERE type != 'ROUTER'", []).ok();
            for ip in &found_ips {
                conn.execute(
                    "UPDATE nodes SET status = 'ONLINE', last_seen = datetime('now') WHERE ip = ?1",
                    [ip],
                ).ok();
            }
        }

        // Read final topology
        let final_nodes: Vec<serde_json::Value> = conn.prepare("SELECT id, name, type, ip, mac, parent_id, status FROM nodes ORDER BY name")
            .and_then(|mut s| {
                let r = s.query_map([], |row| {
                    Ok(serde_json::json!({
                        "id": row.get::<_, String>(0)?,
                        "name": row.get::<_, String>(1)?,
                        "type": row.get::<_, String>(2)?,
                        "ip": row.get::<_, Option<String>>(3)?,
                        "mac": row.get::<_, Option<String>>(4)?,
                        "parent_id": row.get::<_, Option<String>>(5)?,
                        "status": row.get::<_, String>(6)?,
                    }))
                })?.filter_map(|r| r.ok()).collect();
                Ok(r)
            }).unwrap_or_default();

        conn.execute(
            "INSERT INTO network_logs (id, action, status, message) VALUES (?1, 'topology_auto', 'OK', ?2)",
            rusqlite::params![gen_id(), format!("Auto-detect: {} nodos ({} nuevos), {} dispositivos en red", final_nodes.len(), created, found_devices.len())],
        ).ok();

        println!("[Topology] {} total nodes, {} created, {} devices found", final_nodes.len(), created, found_devices.len());

        Ok(serde_json::json!({
            "total_nodes": final_nodes.len(),
            "created": created,
            "devices_found": found_devices.len(),
            "nodes": final_nodes,
        }))
    }).await.map_err(|e| e.to_string())?
}
