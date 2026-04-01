use crate::db::Database;
use crate::mikrotik::{MikroTikClient, MikroTikConnection};
use serde_json::Value;
use tauri::State;

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------
fn gen_id() -> String {
    chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0).to_string()
}

fn get_setting(conn: &rusqlite::Connection, key: &str) -> String {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .unwrap_or_default()
}

fn make_client(db_path: &std::path::Path) -> Result<MikroTikClient, String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("DB error: {}", e))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();
    let client = MikroTikClient::new(
        &get_setting(&conn, "mikrotik_host"),
        get_setting(&conn, "mikrotik_port").parse().unwrap_or(8728),
        &get_setting(&conn, "mikrotik_user"),
        &get_setting(&conn, "mikrotik_password"),
    );
    drop(conn);
    Ok(client)
}

fn jstr(v: &Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn log_to_db(db_path: &std::path::Path, action: &str, status: &str, message: &str, details: Option<&str>) {
    if let Ok(conn) = rusqlite::Connection::open(db_path) {
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();
        let id = gen_id();
        conn.execute(
            "INSERT INTO network_logs (id, action, status, message, details) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, action, status, message, details],
        ).ok();
    }
}

// ---------------------------------------------------------------------------
// Subnet detection (same as network.rs but self-contained)
// ---------------------------------------------------------------------------
struct DetectedSubnets {
    management_subnet: String,
    client_subnet: String,
    vpn_subnet: String,
}

fn ip_to_network_cidr(addr: &str) -> Option<String> {
    let parts: Vec<&str> = addr.split('/').collect();
    if parts.len() != 2 { return None; }
    let octets: Vec<&str> = parts[0].split('.').collect();
    if octets.len() != 4 { return None; }
    let prefix: u8 = parts[1].parse().ok()?;
    if prefix >= 24 {
        Some(format!("{}.{}.{}.0/{}", octets[0], octets[1], octets[2], parts[1]))
    } else if prefix >= 16 {
        Some(format!("{}.{}.0.0/{}", octets[0], octets[1], parts[1]))
    } else {
        Some(format!("{}.0.0.0/{}", octets[0], parts[1]))
    }
}

fn detect_subnets(mt: &mut MikroTikConnection) -> DetectedSubnets {
    let addresses = mt.get_ip_addresses().unwrap_or_default();
    let pools = mt.get_ip_pool().unwrap_or_default();
    let interfaces = mt.get_interfaces().unwrap_or_default();

    let mut management_subnet = String::new();
    let bridge_names: Vec<String> = interfaces.iter()
        .filter(|i| jstr(i, "type") == "bridge")
        .map(|i| jstr(i, "name"))
        .collect();
    for preferred in &["bridge-lan", "bridge"] {
        for addr in &addresses {
            if jstr(addr, "interface") == *preferred {
                if let Some(cidr) = ip_to_network_cidr(&jstr(addr, "address")) {
                    management_subnet = cidr;
                    break;
                }
            }
        }
        if !management_subnet.is_empty() { break; }
    }
    if management_subnet.is_empty() {
        for addr in &addresses {
            if bridge_names.contains(&jstr(addr, "interface")) {
                if let Some(cidr) = ip_to_network_cidr(&jstr(addr, "address")) {
                    management_subnet = cidr;
                    break;
                }
            }
        }
    }

    let mut client_subnet = String::new();
    let pool = pools.iter().find(|p| jstr(p, "name") == "pool-clientes").or_else(|| pools.first());
    if let Some(p) = pool {
        let ranges = jstr(p, "ranges");
        if let Some(first_ip) = ranges.split('-').next() {
            let octets: Vec<&str> = first_ip.trim().split('.').collect();
            if octets.len() == 4 {
                client_subnet = format!("{}.{}.{}.0/24", octets[0], octets[1], octets[2]);
            }
        }
    }

    let mut vpn_subnet = String::new();
    for addr in &addresses {
        let iface = jstr(addr, "interface");
        let is_wg = interfaces.iter().any(|i| {
            jstr(i, "name") == iface && (jstr(i, "type") == "wg" || jstr(i, "type") == "wireguard" || iface.starts_with("wg"))
        });
        if is_wg {
            if let Some(cidr) = ip_to_network_cidr(&jstr(addr, "address")) {
                vpn_subnet = cidr;
                break;
            }
        }
    }

    DetectedSubnets { management_subnet, client_subnet, vpn_subnet }
}

// ---------------------------------------------------------------------------
// Generic helpers: remove rules by comment prefix from various tables
// ---------------------------------------------------------------------------
fn remove_rules_by_comment(mt: &mut MikroTikConnection, table: &str, prefix: &str, errors: &mut Vec<String>) {
    let print_cmd = format!("{}/print", table);
    let remove_cmd = format!("{}/remove", table);

    if let Ok(rules) = mt.query(&print_cmd, &[]) {
        let ids: Vec<String> = rules.iter()
            .filter(|r| {
                r.get("comment").and_then(|v| v.as_str()).unwrap_or("").starts_with(prefix)
            })
            .filter_map(|r| r.get(".id").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .collect();
        for id in ids.iter().rev() {
            if let Err(e) = mt.query(&remove_cmd, &[&format!("=.id={}", id)]) {
                errors.push(format!("Error removing {} rule {}: {}", table, id, e));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// get_protection_status — current state of all protection modules
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn get_protection_status(db: State<'_, Database>) -> Result<Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;

        match client.connect() {
            Ok(mut mt) => {
                // Read ISP setting
                let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
                conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();
                let isp_type = get_setting(&conn, "isp_type"); // "starlink", "izzi", "telmex", "other"
                drop(conn);

                let is_starlink = isp_type == "starlink";

                // Check each module
                let torrent = check_module(&mut mt, "starlink torrent");
                let high_download = check_module(&mut mt, "starlink high-download");
                let gaming = check_module_multi(&mut mt, &[
                    ("/ip/firewall/mangle", "starlink gaming"),
                    ("/queue/tree", "starlink gaming"),
                ]);
                let firewall_hard = check_module_multi(&mut mt, &[
                    ("/ip/firewall/raw", "starlink fw-bogon"),
                    ("/ip/firewall/filter", "starlink fw-portscan"),
                ]);
                let ip_protect = check_module(&mut mt, "starlink ip-protect");
                let port_forward = check_nat_module(&mut mt, "portfwd");

                // Starlink-specific
                let anti_detect = check_module_multi(&mut mt, &[
                    ("/ip/firewall/mangle", "starlink anti-detect"),
                    ("/ip/firewall/nat", "starlink anti-detect"),
                ]);
                let anti_stow = check_module_multi(&mut mt, &[
                    ("/system/script", "starlink anti-stow"),
                    ("/system/scheduler", "starlink anti-stow"),
                ]);
                let app_block = check_module_multi(&mut mt, &[
                    ("/ip/dns/static", "starlink app-block"),
                    ("/ip/firewall/filter", "starlink app-block"),
                ]);
                let dns_redirect = check_nat_module(&mut mt, "starlink anti-detect dns-redirect");
                let conntrack = check_conntrack_optimized(&mut mt);

                Ok(serde_json::json!({
                    "connected": true,
                    "isp_type": isp_type,
                    "is_starlink": is_starlink,
                    "universal": {
                        "torrent_block": torrent,
                        "high_download_block": high_download,
                        "gaming_priority": gaming,
                        "firewall_hardening": firewall_hard,
                        "ip_protection": ip_protect,
                        "port_forwarding": port_forward,
                    },
                    "starlink": {
                        "anti_isp_detection": anti_detect,
                        "anti_stow": anti_stow,
                        "app_block": app_block,
                        "dns_redirect": dns_redirect,
                        "conntrack_optimized": conntrack,
                    },
                }))
            }
            Err(e) => Ok(serde_json::json!({
                "connected": false,
                "error": format!("No se pudo conectar: {}", e),
            })),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn check_module(mt: &mut MikroTikConnection, prefix: &str) -> Value {
    let full_prefix = format!("LK: {}", prefix);
    match mt.get_firewall_filter() {
        Ok(rules) => {
            let matching: Vec<&Value> = rules.iter()
                .filter(|r| r.get("comment").and_then(|v| v.as_str()).unwrap_or("").starts_with(&full_prefix))
                .collect();
            let total = matching.len();
            let disabled = matching.iter().filter(|r| {
                r.get("disabled").and_then(|v| v.as_str()) == Some("true")
            }).count();
            serde_json::json!({
                "active": total > 0 && disabled < total,
                "rules": total,
                "disabled": disabled,
            })
        }
        Err(_) => serde_json::json!({ "active": false, "rules": 0 }),
    }
}

fn check_module_multi(mt: &mut MikroTikConnection, tables: &[(&str, &str)]) -> Value {
    let mut total = 0usize;
    let mut disabled = 0usize;
    for (table, prefix) in tables {
        let full_prefix = format!("LK: {}", prefix);
        let print_cmd = format!("{}/print", table);
        if let Ok(rules) = mt.query(&print_cmd, &[]) {
            for r in &rules {
                if r.get("comment").and_then(|v| v.as_str()).unwrap_or("").starts_with(&full_prefix) {
                    total += 1;
                    if r.get("disabled").and_then(|v| v.as_str()) == Some("true") {
                        disabled += 1;
                    }
                }
            }
        }
    }
    serde_json::json!({
        "active": total > 0 && disabled < total,
        "rules": total,
        "disabled": disabled,
    })
}

fn check_nat_module(mt: &mut MikroTikConnection, prefix: &str) -> Value {
    let full_prefix = format!("LK: {}", prefix);
    match mt.get_firewall_nat() {
        Ok(rules) => {
            let total = rules.iter()
                .filter(|r| r.get("comment").and_then(|v| v.as_str()).unwrap_or("").starts_with(&full_prefix))
                .count();
            serde_json::json!({ "active": total > 0, "rules": total })
        }
        Err(_) => serde_json::json!({ "active": false, "rules": 0 }),
    }
}

fn check_conntrack_optimized(mt: &mut MikroTikConnection) -> Value {
    match mt.query("/ip/firewall/connection/tracking/print", &[]) {
        Ok(ct) => {
            if let Some(c) = ct.first() {
                let tcp_est = jstr(c, "tcp-established-timeout");
                // Default is 1d (86400), optimized is 1h (3600) or less
                let is_optimized = tcp_est.contains('h') && !tcp_est.contains('d');
                serde_json::json!({
                    "active": is_optimized,
                    "tcp_established": tcp_est,
                    "udp_timeout": jstr(c, "udp-timeout"),
                })
            } else {
                serde_json::json!({ "active": false })
            }
        }
        Err(_) => serde_json::json!({ "active": false }),
    }
}

// ---------------------------------------------------------------------------
// apply_protection — apply a specific protection module
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn apply_protection(db: State<'_, Database>, module: String) -> Result<Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;
        let mut applied: Vec<String> = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        match client.connect() {
            Ok(mut mt) => {
                let subnets = detect_subnets(&mut mt);

                match module.as_str() {
                    // === UNIVERSAL MODULES ===
                    "torrent_block" => apply_torrent_block(&mut mt, &subnets, &mut applied, &mut errors),
                    "high_download_block" => apply_high_download_block(&mut mt, &subnets, &mut applied, &mut errors),
                    "gaming_priority" => apply_gaming_priority(&mut mt, &subnets, &mut applied, &mut errors),
                    "firewall_hardening" => apply_firewall_hardening(&mut mt, &subnets, &mut applied, &mut errors),
                    "ip_protection" => apply_ip_protection(&mut mt, &subnets, &mut applied, &mut errors),

                    // === STARLINK-SPECIFIC MODULES ===
                    "anti_isp_detection" => apply_anti_isp_detection(&mut mt, &subnets, &mut applied, &mut errors),
                    "anti_stow" => apply_anti_stow(&mut mt, &mut applied, &mut errors),
                    "app_block" => apply_starlink_app_block(&mut mt, &subnets, &mut applied, &mut errors),
                    "dns_redirect" => apply_dns_redirect(&mut mt, &subnets, &mut applied, &mut errors),
                    "conntrack_optimize" => apply_conntrack_optimize(&mut mt, &mut applied, &mut errors),

                    // === ALL AT ONCE ===
                    "all_universal" => {
                        apply_torrent_block(&mut mt, &subnets, &mut applied, &mut errors);
                        apply_high_download_block(&mut mt, &subnets, &mut applied, &mut errors);
                        apply_gaming_priority(&mut mt, &subnets, &mut applied, &mut errors);
                        apply_firewall_hardening(&mut mt, &subnets, &mut applied, &mut errors);
                        apply_ip_protection(&mut mt, &subnets, &mut applied, &mut errors);
                    }
                    "all_starlink" => {
                        // Universal first
                        apply_torrent_block(&mut mt, &subnets, &mut applied, &mut errors);
                        apply_high_download_block(&mut mt, &subnets, &mut applied, &mut errors);
                        apply_gaming_priority(&mut mt, &subnets, &mut applied, &mut errors);
                        apply_firewall_hardening(&mut mt, &subnets, &mut applied, &mut errors);
                        apply_ip_protection(&mut mt, &subnets, &mut applied, &mut errors);
                        // Then Starlink-specific
                        apply_anti_isp_detection(&mut mt, &subnets, &mut applied, &mut errors);
                        apply_anti_stow(&mut mt, &mut applied, &mut errors);
                        apply_starlink_app_block(&mut mt, &subnets, &mut applied, &mut errors);
                        apply_dns_redirect(&mut mt, &subnets, &mut applied, &mut errors);
                        apply_conntrack_optimize(&mut mt, &mut applied, &mut errors);
                    }

                    _ => errors.push(format!("Unknown protection module: {}", module)),
                }

                let status = if errors.is_empty() { "OK" } else if !applied.is_empty() { "PARTIAL" } else { "ERROR" };
                let message = format!("{}: {} applied, {} errors", module, applied.len(), errors.len());
                log_to_db(&db_path, &format!("protection:{}", module), status, &message,
                    Some(&serde_json::to_string(&serde_json::json!({"applied": applied, "errors": errors})).unwrap_or_default()));

                Ok(serde_json::json!({
                    "success": errors.is_empty(),
                    "module": module,
                    "applied": applied,
                    "errors": errors,
                    "message": message,
                }))
            }
            Err(e) => Ok(serde_json::json!({
                "success": false,
                "error": format!("No se pudo conectar: {}", e),
            })),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// remove_protection — remove a specific protection module
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn remove_protection(db: State<'_, Database>, module: String) -> Result<Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;
        let mut errors: Vec<String> = Vec::new();

        match client.connect() {
            Ok(mut mt) => {
                let prefix = match module.as_str() {
                    "torrent_block" => "LK: starlink torrent",
                    "high_download_block" => "LK: starlink high-download",
                    "gaming_priority" => "LK: starlink gaming",
                    "firewall_hardening" => "LK: starlink fw-",
                    "ip_protection" => "LK: starlink ip-protect",
                    "anti_isp_detection" => "LK: starlink anti-detect",
                    "anti_stow" => "LK: starlink anti-stow",
                    "app_block" => "LK: starlink app-block",
                    "dns_redirect" => "LK: starlink anti-detect dns-redirect",
                    "conntrack_optimize" => "",
                    _ => {
                        return Ok(serde_json::json!({
                            "success": false,
                            "error": format!("Unknown module: {}", module),
                        }));
                    }
                };

                if !prefix.is_empty() {
                    // Remove from all tables where these rules might exist
                    let tables = [
                        "/ip/firewall/filter",
                        "/ip/firewall/mangle",
                        "/ip/firewall/nat",
                        "/ip/firewall/raw",
                        "/ip/firewall/layer7-protocol",
                        "/ip/firewall/address-list",
                        "/ip/dns/static",
                        "/queue/tree",
                        "/system/script",
                        "/system/scheduler",
                        "/tool/netwatch",
                    ];
                    for table in &tables {
                        remove_rules_by_comment(&mut mt, table, prefix, &mut errors);
                    }

                    // Gaming also needs mangle cleanup
                    if module == "gaming_priority" {
                        remove_rules_by_comment(&mut mt, "/ip/firewall/mangle", "LK: starlink general", &mut errors);
                    }
                }

                // Special: conntrack reset to defaults
                if module == "conntrack_optimize" {
                    if let Err(e) = mt.query("/ip/firewall/connection/tracking/set", &[
                        "=tcp-established-timeout=1d",
                        "=tcp-close-wait-timeout=10s",
                        "=tcp-fin-wait-timeout=10s",
                        "=tcp-time-wait-timeout=10s",
                        "=udp-timeout=10s",
                        "=udp-stream-timeout=3m",
                        "=generic-timeout=10m",
                    ]) {
                        errors.push(format!("Conntrack reset: {}", e));
                    }
                }

                let success = errors.is_empty();
                log_to_db(&db_path, &format!("remove_protection:{}", module),
                    if success { "OK" } else { "PARTIAL" },
                    &format!("Removed {} protection (errors: {})", module, errors.len()), None);

                Ok(serde_json::json!({
                    "success": success,
                    "module": module,
                    "errors": errors,
                }))
            }
            Err(e) => Ok(serde_json::json!({
                "success": false,
                "error": format!("No se pudo conectar: {}", e),
            })),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ===========================================================================
// UNIVERSAL PROTECTION MODULES
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. TORRENT BLOCK — L7 + port blocking + connection limits
// ---------------------------------------------------------------------------
fn apply_torrent_block(mt: &mut MikroTikConnection, subnets: &DetectedSubnets, applied: &mut Vec<String>, errors: &mut Vec<String>) {
    println!("[Protection] Applying torrent block...");

    // Clean existing
    remove_rules_by_comment(mt, "/ip/firewall/layer7-protocol", "LK: starlink torrent", errors);
    remove_rules_by_comment(mt, "/ip/firewall/filter", "LK: starlink torrent", errors);

    // Layer-7 protocol for BitTorrent detection
    let l7_result = mt.add_layer7_protocol(&[
        "=name=LK-torrent-detect",
        "=regexp=^(\\x13BitTorrent protocol|d1:ad2:id20:|GET /announce\\?info_hash=|GET /scrape\\?info_hash=)",
        "=comment=LK: starlink torrent l7-protocol",
    ]);
    match l7_result {
        Ok(_) => applied.push("L7: BitTorrent protocol detection".into()),
        Err(e) => errors.push(format!("L7 torrent: {}", e)),
    }

    // TCP port block for known torrent ports
    let rules: Vec<(&str, Vec<String>)> = vec![
        ("Block torrent TCP ports", vec![
            "=chain=forward".into(), "=action=drop".into(),
            "=protocol=tcp".into(), "=dst-port=6881-6999,2710,6969".into(),
            "=comment=LK: starlink torrent-ports-tcp-drop".into(),
        ]),
        ("Block torrent UDP ports", vec![
            "=chain=forward".into(), "=action=drop".into(),
            "=protocol=udp".into(), "=dst-port=6881-6999,2710,6969".into(),
            "=comment=LK: starlink torrent-ports-udp-drop".into(),
        ]),
        ("Block L7 torrent traffic", vec![
            "=chain=forward".into(), "=action=drop".into(),
            "=layer7-protocol=LK-torrent-detect".into(),
            "=comment=LK: starlink torrent-l7-drop".into(),
        ]),
    ];

    for (desc, args) in &rules {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_firewall_filter(&refs) {
            Ok(_) => applied.push(desc.to_string()),
            Err(e) => errors.push(format!("{}: {}", desc, e)),
        }
    }

    // Connection limit per IP (anti P2P swarm)
    if !subnets.client_subnet.is_empty() {
        let args: Vec<String> = vec![
            "=chain=forward".into(), "=action=drop".into(),
            "=protocol=tcp".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=connection-limit=100,32".into(),
            "=comment=LK: starlink torrent-conn-limit".into(),
        ];
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_firewall_filter(&refs) {
            Ok(_) => applied.push("Connection limit per IP (100 max)".into()),
            Err(e) => errors.push(format!("Conn limit: {}", e)),
        }
    }
}

// ---------------------------------------------------------------------------
// 2. HIGH DOWNLOAD BLOCK — connection limits + heavy user detection
// ---------------------------------------------------------------------------
fn apply_high_download_block(mt: &mut MikroTikConnection, subnets: &DetectedSubnets, applied: &mut Vec<String>, errors: &mut Vec<String>) {
    println!("[Protection] Applying high download block...");

    remove_rules_by_comment(mt, "/ip/firewall/filter", "LK: starlink high-download", errors);
    remove_rules_by_comment(mt, "/ip/firewall/address-list", "LK: starlink heavy", errors);

    if subnets.client_subnet.is_empty() {
        errors.push("No client subnet detected".into());
        return;
    }

    let rules: Vec<(&str, Vec<String>)> = vec![
        ("SYN rate limit per client", vec![
            "=chain=forward".into(), "=action=drop".into(),
            "=protocol=tcp".into(), "=tcp-flags=syn".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=connection-limit=50,32".into(),
            "=comment=LK: starlink high-download-syn-limit".into(),
        ]),
        ("Detect heavy users (>300 conn)", vec![
            "=chain=forward".into(), "=action=add-src-to-address-list".into(),
            "=address-list=LK-heavy-users".into(),
            "=address-list-timeout=10m".into(),
            "=protocol=tcp".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=connection-limit=300,32".into(),
            "=comment=LK: starlink high-download-heavy-detect".into(),
        ]),
        ("Throttle heavy users", vec![
            "=chain=forward".into(), "=action=drop".into(),
            "=src-address-list=LK-heavy-users".into(),
            "=connection-limit=150,32".into(),
            "=comment=LK: starlink high-download-heavy-throttle".into(),
        ]),
    ];

    for (desc, args) in &rules {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_firewall_filter(&refs) {
            Ok(_) => applied.push(desc.to_string()),
            Err(e) => errors.push(format!("{}: {}", desc, e)),
        }
    }
}

// ---------------------------------------------------------------------------
// 3. GAMING PRIORITY — mangle marks + queue trees
// ---------------------------------------------------------------------------
fn apply_gaming_priority(mt: &mut MikroTikConnection, _subnets: &DetectedSubnets, applied: &mut Vec<String>, errors: &mut Vec<String>) {
    println!("[Protection] Applying gaming priority...");

    remove_rules_by_comment(mt, "/ip/firewall/mangle", "LK: starlink gaming", errors);
    remove_rules_by_comment(mt, "/ip/firewall/mangle", "LK: starlink general", errors);
    remove_rules_by_comment(mt, "/queue/tree", "LK: starlink gaming", errors);
    remove_rules_by_comment(mt, "/queue/tree", "LK: starlink general", errors);

    // Gaming ports (UDP dominant for real-time gaming)
    let gaming_udp = "3074,3478-3480,3658,5222,5795-5847,27015-27050";
    let gaming_tcp = "3074,8393-8400,25565,27015-27050";

    // Mangle rules for gaming traffic
    let mangle_rules: Vec<(&str, Vec<String>)> = vec![
        ("Mark gaming connections (UDP)", vec![
            "=chain=prerouting".into(), "=action=mark-connection".into(),
            "=new-connection-mark=LK-gaming-conn".into(), "=passthrough=yes".into(),
            "=protocol=udp".into(), format!("=dst-port={}", gaming_udp),
            "=comment=LK: starlink gaming-mark-conn-udp".into(),
        ]),
        ("Mark gaming connections (TCP)", vec![
            "=chain=prerouting".into(), "=action=mark-connection".into(),
            "=new-connection-mark=LK-gaming-conn".into(), "=passthrough=yes".into(),
            "=protocol=tcp".into(), format!("=dst-port={}", gaming_tcp),
            "=comment=LK: starlink gaming-mark-conn-tcp".into(),
        ]),
        ("Mark gaming packets", vec![
            "=chain=prerouting".into(), "=action=mark-packet".into(),
            "=new-packet-mark=LK-gaming-pkt".into(), "=passthrough=no".into(),
            "=connection-mark=LK-gaming-conn".into(),
            "=comment=LK: starlink gaming-mark-pkt".into(),
        ]),
        ("Mark general connections", vec![
            "=chain=prerouting".into(), "=action=mark-connection".into(),
            "=new-connection-mark=LK-general-conn".into(), "=passthrough=yes".into(),
            "=connection-mark=no-mark".into(),
            "=comment=LK: starlink general-mark-conn".into(),
        ]),
        ("Mark general packets", vec![
            "=chain=prerouting".into(), "=action=mark-packet".into(),
            "=new-packet-mark=LK-general-pkt".into(), "=passthrough=no".into(),
            "=connection-mark=LK-general-conn".into(),
            "=comment=LK: starlink general-mark-pkt".into(),
        ]),
    ];

    for (desc, args) in &mangle_rules {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_mangle_rule(&refs) {
            Ok(_) => applied.push(format!("Mangle: {}", desc)),
            Err(e) => errors.push(format!("Mangle {}: {}", desc, e)),
        }
    }

    // Queue trees with priority
    let queue_rules: Vec<(&str, Vec<String>)> = vec![
        ("Gaming queue (priority 1)", vec![
            "=name=LK-gaming-queue".into(),
            "=parent=global".into(),
            "=packet-mark=LK-gaming-pkt".into(),
            "=priority=1".into(),
            "=queue=default".into(),
            "=comment=LK: starlink gaming-priority-queue".into(),
        ]),
        ("General queue (priority 8)", vec![
            "=name=LK-general-queue".into(),
            "=parent=global".into(),
            "=packet-mark=LK-general-pkt".into(),
            "=priority=8".into(),
            "=queue=default".into(),
            "=comment=LK: starlink general-priority-queue".into(),
        ]),
    ];

    for (desc, args) in &queue_rules {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_queue_tree(&refs) {
            Ok(_) => applied.push(format!("Queue: {}", desc)),
            Err(e) => errors.push(format!("Queue {}: {}", desc, e)),
        }
    }
}

// ---------------------------------------------------------------------------
// 4. FIREWALL HARDENING — bogon filtering, port scan detection
// ---------------------------------------------------------------------------
fn apply_firewall_hardening(mt: &mut MikroTikConnection, _subnets: &DetectedSubnets, applied: &mut Vec<String>, errors: &mut Vec<String>) {
    println!("[Protection] Applying firewall hardening...");

    remove_rules_by_comment(mt, "/ip/firewall/raw", "LK: starlink fw-bogon", errors);
    remove_rules_by_comment(mt, "/ip/firewall/filter", "LK: starlink fw-", errors);

    // Bogon/Martian IP filtering on WAN (raw table for performance)
    let bogon_ranges = [
        ("0.0.0.0/8", "bogon-0"),
        ("10.0.0.0/8", "bogon-10"),
        ("127.0.0.0/8", "bogon-127"),
        ("169.254.0.0/16", "bogon-169"),
        ("172.16.0.0/12", "bogon-172"),
        ("192.168.0.0/16", "bogon-192"),
        ("224.0.0.0/4", "bogon-multicast"),
    ];

    for (range, name) in &bogon_ranges {
        let args: Vec<String> = vec![
            "=chain=prerouting".into(), "=action=drop".into(),
            "=in-interface-list=WAN".into(),
            format!("=src-address={}", range),
            format!("=comment=LK: starlink fw-bogon-{}", name),
        ];
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_raw_rule(&refs) {
            Ok(_) => applied.push(format!("Raw: Drop bogon {}", range)),
            Err(e) => errors.push(format!("Bogon {}: {}", range, e)),
        }
    }

    // Port scan detection
    let scan_rules: Vec<(&str, Vec<String>)> = vec![
        ("Port scan detection", vec![
            "=chain=input".into(), "=action=add-src-to-address-list".into(),
            "=address-list=LK-port-scanners".into(), "=address-list-timeout=1d".into(),
            "=protocol=tcp".into(), "=psd=21,3s,3,1".into(),
            "=comment=LK: starlink fw-portscan-detect".into(),
        ]),
        ("Drop port scanners", vec![
            "=chain=input".into(), "=action=drop".into(),
            "=src-address-list=LK-port-scanners".into(),
            "=comment=LK: starlink fw-portscan-drop".into(),
        ]),
        ("Drop WAN without DSTNAT", vec![
            "=chain=forward".into(), "=action=drop".into(),
            "=in-interface-list=WAN".into(),
            "=connection-state=new".into(),
            "=connection-nat-state=!dstnat".into(),
            "=comment=LK: starlink fw-drop-wan-no-dstnat".into(),
        ]),
    ];

    for (desc, args) in &scan_rules {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_firewall_filter(&refs) {
            Ok(_) => applied.push(desc.to_string()),
            Err(e) => errors.push(format!("{}: {}", desc, e)),
        }
    }
}

// ---------------------------------------------------------------------------
// 5. IP PROTECTION — hide infrastructure from clients
// ---------------------------------------------------------------------------
fn apply_ip_protection(mt: &mut MikroTikConnection, subnets: &DetectedSubnets, applied: &mut Vec<String>, errors: &mut Vec<String>) {
    println!("[Protection] Applying IP protection...");

    remove_rules_by_comment(mt, "/ip/firewall/filter", "LK: starlink ip-protect", errors);

    if subnets.client_subnet.is_empty() {
        errors.push("No client subnet detected".into());
        return;
    }

    let rules: Vec<(&str, Vec<String>)> = vec![
        ("Block traceroute UDP from clients", vec![
            "=chain=input".into(), "=action=drop".into(),
            "=protocol=udp".into(), "=dst-port=33434-33534".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=comment=LK: starlink ip-protect-traceroute-udp".into(),
        ]),
        ("Block traceroute ICMP from clients", vec![
            "=chain=input".into(), "=action=drop".into(),
            "=protocol=icmp".into(), "=icmp-options=11:0".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=comment=LK: starlink ip-protect-traceroute-icmp".into(),
        ]),
        ("Allow DNS from clients", vec![
            "=chain=input".into(), "=action=accept".into(),
            "=protocol=udp".into(), "=dst-port=53".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=comment=LK: starlink ip-protect-allow-dns-udp".into(),
        ]),
        ("Allow DNS TCP from clients", vec![
            "=chain=input".into(), "=action=accept".into(),
            "=protocol=tcp".into(), "=dst-port=53".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=comment=LK: starlink ip-protect-allow-dns-tcp".into(),
        ]),
        ("Drop all other client-to-router", vec![
            "=chain=input".into(), "=action=drop".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=comment=LK: starlink ip-protect-drop-client-router".into(),
        ]),
    ];

    for (desc, args) in &rules {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_firewall_filter(&refs) {
            Ok(_) => applied.push(desc.to_string()),
            Err(e) => errors.push(format!("{}: {}", desc, e)),
        }
    }

    // Restrict services to management/VPN only
    let mgmt_addresses = if !subnets.vpn_subnet.is_empty() {
        format!("{},{}", subnets.management_subnet, subnets.vpn_subnet)
    } else {
        subnets.management_subnet.clone()
    };

    if !mgmt_addresses.is_empty() {
        for (svc, disable) in &[
            ("telnet", true), ("ftp", true), ("www", true),
            ("api-ssl", true),
        ] {
            let action = if *disable { "=disabled=yes" } else { &format!("=address={}", mgmt_addresses) };
            if let Err(e) = mt.set_ip_service(svc, &[action]) {
                errors.push(format!("Service {}: {}", svc, e));
            } else {
                applied.push(format!("Restricted service: {}", svc));
            }
        }

        // Restrict winbox, ssh, api to management
        for svc in &["winbox", "ssh"] {
            let addr_arg = format!("=address={}", mgmt_addresses);
            if let Err(e) = mt.set_ip_service(svc, &[&addr_arg]) {
                errors.push(format!("Service {}: {}", svc, e));
            } else {
                applied.push(format!("Restricted service: {} -> {}", svc, mgmt_addresses));
            }
        }

        // API restricted to VPN only
        if !subnets.vpn_subnet.is_empty() {
            let api_addr = format!("=address={}", subnets.vpn_subnet);
            if let Err(e) = mt.set_ip_service("api", &[&api_addr]) {
                errors.push(format!("Service api: {}", e));
            } else {
                applied.push(format!("Restricted service: api -> {}", subnets.vpn_subnet));
            }
        }
    }
}

// ===========================================================================
// STARLINK-SPECIFIC PROTECTION MODULES
// ===========================================================================

// ---------------------------------------------------------------------------
// 6. ANTI-ISP DETECTION — TTL manipulation, MSS clamp, DNS fingerprint
// ---------------------------------------------------------------------------
fn apply_anti_isp_detection(mt: &mut MikroTikConnection, subnets: &DetectedSubnets, applied: &mut Vec<String>, errors: &mut Vec<String>) {
    println!("[Protection] Applying anti-ISP detection (Starlink)...");

    remove_rules_by_comment(mt, "/ip/firewall/mangle", "LK: starlink anti-detect", errors);
    remove_rules_by_comment(mt, "/ip/firewall/nat", "LK: starlink anti-detect", errors);
    remove_rules_by_comment(mt, "/ip/firewall/address-list", "LK: starlink DoH", errors);
    remove_rules_by_comment(mt, "/ip/firewall/filter", "LK: starlink anti-detect", errors);

    // TTL manipulation — make all outbound traffic look like single device
    let mangle_rules: Vec<(&str, Vec<String>)> = vec![
        ("Set TTL=64 on all outbound (anti-fingerprint)", vec![
            "=chain=postrouting".into(), "=action=change-ttl".into(),
            "=new-ttl=set:64".into(),
            "=out-interface-list=WAN".into(),
            "=comment=LK: starlink anti-detect ttl-set-64".into(),
        ]),
        ("MSS clamp to PMTU", vec![
            "=chain=forward".into(), "=action=change-mss".into(),
            "=new-mss=clamp-to-pmtu".into(),
            "=protocol=tcp".into(), "=tcp-flags=syn".into(),
            "=comment=LK: starlink anti-detect mss-clamp".into(),
        ]),
    ];

    for (desc, args) in &mangle_rules {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_mangle_rule(&refs) {
            Ok(_) => applied.push(format!("Mangle: {}", desc)),
            Err(e) => errors.push(format!("Mangle {}: {}", desc, e)),
        }
    }

    // IPv6 hop-limit (if IPv6 exists)
    let ipv6_args = vec![
        "=chain=postrouting", "=action=change-hop-limit",
        "=new-hop-limit=set:64",
        "=out-interface-list=WAN",
        "=comment=LK: starlink anti-detect ipv6-hop-limit",
    ];
    match mt.add_ipv6_mangle_rule(&ipv6_args) {
        Ok(_) => applied.push("IPv6: Set hop-limit=64".into()),
        Err(e) => {
            // IPv6 might not be available on all routers — not critical
            println!("[Protection] IPv6 mangle skipped: {}", e);
        }
    }

    // DoH blocking — prevent DNS fingerprint leaks
    let doh_servers = [
        ("1.1.1.1", "Cloudflare"),
        ("1.0.0.1", "Cloudflare2"),
        ("8.8.8.8", "Google"),
        ("8.8.4.4", "Google2"),
        ("9.9.9.9", "Quad9"),
    ];

    for (ip, name) in &doh_servers {
        let args = vec![
            format!("=list=LK-doh-servers"),
            format!("=address={}", ip),
            format!("=comment=LK: starlink DoH {}", name),
        ];
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_address_list(&refs) {
            Ok(_) => applied.push(format!("Address list: DoH {}", name)),
            Err(e) => errors.push(format!("DoH {}: {}", name, e)),
        }
    }

    // Block DoH from clients
    if !subnets.client_subnet.is_empty() {
        let args: Vec<String> = vec![
            "=chain=forward".into(), "=action=drop".into(),
            "=protocol=tcp".into(), "=dst-port=443".into(),
            "=dst-address-list=LK-doh-servers".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=comment=LK: starlink anti-detect doh-block".into(),
        ];
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_firewall_filter(&refs) {
            Ok(_) => applied.push("Block DoH from clients".into()),
            Err(e) => errors.push(format!("DoH block: {}", e)),
        }
    }
}

// ---------------------------------------------------------------------------
// 7. ANTI-STOW / ANTI-SLEEP — keepalive scripts + scheduler
// ---------------------------------------------------------------------------
fn apply_anti_stow(mt: &mut MikroTikConnection, applied: &mut Vec<String>, errors: &mut Vec<String>) {
    println!("[Protection] Applying anti-stow/anti-sleep (Starlink)...");

    remove_rules_by_comment(mt, "/system/script", "LK: starlink anti-stow", errors);
    remove_rules_by_comment(mt, "/system/scheduler", "LK: starlink anti-stow", errors);
    remove_rules_by_comment(mt, "/system/scheduler", "LK: starlink anti-sleep", errors);
    remove_rules_by_comment(mt, "/tool/netwatch", "LK: starlink anti-stow", errors);

    // Keepalive script
    let script_source = r#":local targets {"8.8.8.8";"1.1.1.1";"208.67.222.222"}
:foreach t in=$targets do={
  /ping $t count=2 interval=500ms
}
:resolve "www.google.com"
:resolve "www.microsoft.com"
:resolve "www.apple.com""#;

    let script_args = vec![
        "=name=LK-anti-stow".to_string(),
        format!("=source={}", script_source),
        "=policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon".to_string(),
        "=comment=LK: starlink anti-stow keepalive-script".to_string(),
    ];
    let refs: Vec<&str> = script_args.iter().map(|s| s.as_str()).collect();
    match mt.add_script(&refs) {
        Ok(_) => applied.push("Script: LK-anti-stow keepalive".into()),
        Err(e) => errors.push(format!("Anti-stow script: {}", e)),
    }

    // Scheduler: run every 30 seconds
    let sched_args = vec![
        "=name=LK-anti-stow-scheduler",
        "=interval=30s",
        "=on-event=LK-anti-stow",
        "=policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon",
        "=comment=LK: starlink anti-stow scheduler",
    ];
    match mt.add_scheduler(&sched_args) {
        Ok(_) => applied.push("Scheduler: anti-stow every 30s".into()),
        Err(e) => errors.push(format!("Anti-stow scheduler: {}", e)),
    }

    // Simple ping scheduler (every 10s as backup)
    let ping_args = vec![
        "=name=LK-anti-sleep-ping",
        "=interval=10s",
        "=on-event=/ping 8.8.8.8 count=1",
        "=policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon",
        "=comment=LK: starlink anti-sleep ping-scheduler",
    ];
    match mt.add_scheduler(&ping_args) {
        Ok(_) => applied.push("Scheduler: anti-sleep ping every 10s".into()),
        Err(e) => errors.push(format!("Anti-sleep ping: {}", e)),
    }

    // Netwatch: detect internet loss and aggressively try to wake dish
    let down_script = r#":log warning "LK: Internet down - possible Starlink stow"
/ping 8.8.8.8 count=10 interval=200ms
/ping 1.1.1.1 count=5 interval=300ms"#;

    let netwatch_args = vec![
        "=host=8.8.8.8".to_string(),
        "=interval=15s".to_string(),
        "=timeout=5s".to_string(),
        format!("=down-script={}", down_script),
        "=comment=LK: starlink anti-stow netwatch".to_string(),
    ];
    let refs: Vec<&str> = netwatch_args.iter().map(|s| s.as_str()).collect();
    match mt.add_netwatch(&refs) {
        Ok(_) => applied.push("Netwatch: internet loss detector".into()),
        Err(e) => errors.push(format!("Netwatch: {}", e)),
    }
}

// ---------------------------------------------------------------------------
// 8. STARLINK APP BLOCK — DNS sinkhole + IP blocking
// ---------------------------------------------------------------------------
fn apply_starlink_app_block(mt: &mut MikroTikConnection, subnets: &DetectedSubnets, applied: &mut Vec<String>, errors: &mut Vec<String>) {
    println!("[Protection] Applying Starlink app block...");

    remove_rules_by_comment(mt, "/ip/dns/static", "LK: starlink app-block", errors);
    remove_rules_by_comment(mt, "/ip/firewall/filter", "LK: starlink app-block", errors);

    // DNS sinkhole for Starlink domains
    let starlink_domains = [
        "dishy.starlink.com",
        "api.starlink.com",
        "api2.starlink.com",
        "auth.starlink.com",
        "customer.starlink.com",
        "www.starlink.com",
        "starlinkisp.net",
        "satellites.starlink.com",
        "shop.starlink.com",
        "support.starlink.com",
    ];

    for domain in &starlink_domains {
        let args = vec![
            format!("=name={}", domain),
            "=address=0.0.0.0".to_string(),
            "=comment=LK: starlink app-block dns-sinkhole".to_string(),
        ];
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_dns_static(&refs) {
            Ok(_) => applied.push(format!("DNS block: {}", domain)),
            Err(e) => errors.push(format!("DNS block {}: {}", domain, e)),
        }
    }

    if subnets.client_subnet.is_empty() {
        errors.push("No client subnet for IP blocking".into());
        return;
    }

    // Block access to Starlink router from clients
    let fw_rules: Vec<(&str, Vec<String>)> = vec![
        ("Block Starlink router (192.168.100.1)", vec![
            "=chain=forward".into(), "=action=drop".into(),
            "=dst-address=192.168.100.1".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=comment=LK: starlink app-block-router-ip".into(),
        ]),
        ("Block Starlink subnet (192.168.100.0/24)", vec![
            "=chain=forward".into(), "=action=drop".into(),
            "=dst-address=192.168.100.0/24".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=comment=LK: starlink app-block-subnet".into(),
        ]),
        ("Block Starlink gRPC ports", vec![
            "=chain=forward".into(), "=action=drop".into(),
            "=protocol=tcp".into(), "=dst-port=9200-9201".into(),
            "=dst-address=192.168.100.1".into(),
            "=comment=LK: starlink app-block-grpc".into(),
        ]),
    ];

    for (desc, args) in &fw_rules {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_firewall_filter(&refs) {
            Ok(_) => applied.push(desc.to_string()),
            Err(e) => errors.push(format!("{}: {}", desc, e)),
        }
    }
}

// ---------------------------------------------------------------------------
// 9. DNS REDIRECT — force all DNS through MikroTik
// ---------------------------------------------------------------------------
fn apply_dns_redirect(mt: &mut MikroTikConnection, subnets: &DetectedSubnets, applied: &mut Vec<String>, errors: &mut Vec<String>) {
    println!("[Protection] Applying DNS redirect...");

    remove_rules_by_comment(mt, "/ip/firewall/nat", "LK: starlink anti-detect dns-redirect", errors);

    if subnets.client_subnet.is_empty() {
        errors.push("No client subnet for DNS redirect".into());
        return;
    }

    // Redirect all DNS (UDP and TCP) from clients to MikroTik
    let nat_rules: Vec<(&str, Vec<String>)> = vec![
        ("DNS redirect UDP", vec![
            "=chain=dstnat".into(), "=action=redirect".into(),
            "=protocol=udp".into(), "=dst-port=53".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=to-ports=53".into(),
            "=comment=LK: starlink anti-detect dns-redirect-udp".into(),
        ]),
        ("DNS redirect TCP", vec![
            "=chain=dstnat".into(), "=action=redirect".into(),
            "=protocol=tcp".into(), "=dst-port=53".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=to-ports=53".into(),
            "=comment=LK: starlink anti-detect dns-redirect-tcp".into(),
        ]),
    ];

    for (desc, args) in &nat_rules {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_nat_rule(&refs) {
            Ok(_) => applied.push(format!("NAT: {}", desc)),
            Err(e) => errors.push(format!("NAT {}: {}", desc, e)),
        }
    }

    // Ensure MikroTik DNS is configured correctly
    if let Err(e) = mt.query("/ip/dns/set", &[
        "=servers=8.8.8.8,1.1.1.1",
        "=allow-remote-requests=yes",
        "=cache-size=4096",
    ]) {
        errors.push(format!("DNS config: {}", e));
    } else {
        applied.push("DNS: Configured 8.8.8.8/1.1.1.1 with cache".into());
    }
}

// ---------------------------------------------------------------------------
// 10. CONNTRACK OPTIMIZE — reduce connection tracking timeouts
// ---------------------------------------------------------------------------
fn apply_conntrack_optimize(mt: &mut MikroTikConnection, applied: &mut Vec<String>, errors: &mut Vec<String>) {
    println!("[Protection] Applying conntrack optimization...");

    match mt.query("/ip/firewall/connection/tracking/set", &[
        "=tcp-established-timeout=1h",
        "=tcp-close-wait-timeout=10s",
        "=tcp-fin-wait-timeout=10s",
        "=tcp-time-wait-timeout=10s",
        "=udp-timeout=30s",
        "=udp-stream-timeout=3m",
        "=generic-timeout=5m",
    ]) {
        Ok(_) => applied.push("Conntrack: optimized timeouts (tcp-est=1h, udp=30s)".into()),
        Err(e) => errors.push(format!("Conntrack: {}", e)),
    }
}

// detect_wan moved to commands/network.rs
