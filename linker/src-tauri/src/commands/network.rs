use crate::db::Database;
use crate::mikrotik::MikroTikClient;
use tauri::State;

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

const LK_PREFIX: &str = "LK: ";

/// Check if a rule's comment starts with our prefix
fn is_lk_rule(rule: &serde_json::Value) -> bool {
    rule.get("comment")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .starts_with(LK_PREFIX)
}

/// Extract comment from a rule
fn rule_comment(rule: &serde_json::Value) -> &str {
    rule.get("comment").and_then(|v| v.as_str()).unwrap_or("")
}

/// Helper: get a string field from JSON
fn jstr(v: &serde_json::Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

/// Detected subnets from MikroTik — no hardcoded IPs
struct DetectedSubnets {
    management_subnet: String,
    client_subnet: String,
    vpn_subnet: String,
}

fn detect_subnets(mt: &mut crate::mikrotik::MikroTikConnection) -> DetectedSubnets {
    let addresses = mt.get_ip_addresses().unwrap_or_default();
    let pools = mt.get_ip_pool().unwrap_or_default();
    let interfaces = mt.get_interfaces().unwrap_or_default();

    // Management subnet: IP on bridge
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

    // Client subnet: from pool
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

    // VPN subnet: WireGuard interface
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

    println!("[DetectSubnets] management={}, client={}, vpn={}",
        if management_subnet.is_empty() { "(none)" } else { &management_subnet },
        if client_subnet.is_empty() { "(none)" } else { &client_subnet },
        if vpn_subnet.is_empty() { "(none)" } else { &vpn_subnet },
    );

    DetectedSubnets { management_subnet, client_subnet, vpn_subnet }
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

// ---------------------------------------------------------------------------
// get_network_health — queries REAL MikroTik for security module status
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn get_network_health(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;

        match client.connect() {
            Ok(mut mt) => {
                println!("[SecurityHealth] Connected, checking modules...");

                // --- Firewall ---
                let fw_status = match mt.get_firewall_filter() {
                    Ok(rules) => {
                        let lk_rules: Vec<&serde_json::Value> = rules.iter().filter(|r| is_lk_rule(r)).collect();
                        let fw_lk: Vec<&serde_json::Value> = lk_rules.iter()
                            .filter(|r| rule_comment(r).contains("firewall"))
                            .copied().collect();
                        let total = fw_lk.len();
                        let disabled = fw_lk.iter().filter(|r| {
                            r.get("disabled").and_then(|v| v.as_str()) == Some("true")
                        }).count();
                        serde_json::json!({
                            "configured": total > 0,
                            "rules": total,
                            "disabled": disabled,
                            "status": if total >= 6 { "ok" } else if total > 0 { "partial" } else { "none" },
                            "description": if total > 0 {
                                format!("{} reglas ({} activas)", total, total - disabled)
                            } else {
                                "No configurado".to_string()
                            }
                        })
                    }
                    Err(e) => serde_json::json!({ "configured": false, "status": "error", "description": e }),
                };

                // --- QoS ---
                let qos_status = match mt.get_queue_simple() {
                    Ok(queues) => {
                        let lk_queues: Vec<&serde_json::Value> = queues.iter().filter(|q| is_lk_rule(q)).collect();
                        let pcq_types = match mt.query("/queue/type/print", &[]) {
                            Ok(types) => types.iter().filter(|t| is_lk_rule(t)).count(),
                            Err(_) => 0,
                        };
                        let total = lk_queues.len() + pcq_types;
                        serde_json::json!({
                            "configured": total > 0,
                            "rules": total,
                            "status": if total > 0 { "ok" } else { "none" },
                            "description": if total > 0 {
                                format!("{} colas, {} tipos PCQ", lk_queues.len(), pcq_types)
                            } else {
                                "No configurado".to_string()
                            }
                        })
                    }
                    Err(e) => serde_json::json!({ "configured": false, "status": "error", "description": e }),
                };

                // --- DNS ---
                let dns_status = match mt.get_dns() {
                    Ok(dns_list) => {
                        let dns = dns_list.first();
                        let servers = dns.and_then(|d| d.get("servers")).and_then(|v| v.as_str()).unwrap_or("");
                        let allow = dns.and_then(|d| d.get("allow-remote-requests")).and_then(|v| v.as_str()).unwrap_or("false");
                        let cache = dns.and_then(|d| d.get("cache-size")).and_then(|v| v.as_str()).unwrap_or("2048");
                        let has_public = servers.contains("8.8.8.8") || servers.contains("1.1.1.1");
                        let remote_ok = allow == "true";
                        serde_json::json!({
                            "configured": has_public && remote_ok,
                            "status": if has_public && remote_ok { "ok" } else if has_public || remote_ok { "partial" } else { "none" },
                            "servers": servers,
                            "allow_remote": remote_ok,
                            "cache_size": cache,
                            "description": if has_public && remote_ok {
                                format!("DNS: {} | cache: {}KiB | remote: si", servers, cache)
                            } else {
                                format!("DNS: {} | remote: {}", servers, allow)
                            }
                        })
                    }
                    Err(e) => serde_json::json!({ "configured": false, "status": "error", "description": e }),
                };

                // --- Client Isolation ---
                let isolation_status = match mt.get_firewall_filter() {
                    Ok(rules) => {
                        let iso_rules: Vec<&serde_json::Value> = rules.iter()
                            .filter(|r| rule_comment(r).contains("LK: isolation"))
                            .collect();
                        serde_json::json!({
                            "configured": !iso_rules.is_empty(),
                            "rules": iso_rules.len(),
                            "status": if !iso_rules.is_empty() { "ok" } else { "none" },
                            "description": if !iso_rules.is_empty() {
                                format!("{} reglas de aislamiento", iso_rules.len())
                            } else {
                                "No configurado".to_string()
                            }
                        })
                    }
                    Err(e) => serde_json::json!({ "configured": false, "status": "error", "description": e }),
                };

                // --- Anti-DDoS ---
                let ddos_status = match mt.get_firewall_filter() {
                    Ok(rules) => {
                        let ddos_rules: Vec<&serde_json::Value> = rules.iter()
                            .filter(|r| rule_comment(r).contains("LK: antiddos"))
                            .collect();
                        serde_json::json!({
                            "configured": !ddos_rules.is_empty(),
                            "rules": ddos_rules.len(),
                            "status": if ddos_rules.len() >= 3 { "ok" } else if !ddos_rules.is_empty() { "partial" } else { "none" },
                            "description": if !ddos_rules.is_empty() {
                                format!("{} reglas anti-DDoS", ddos_rules.len())
                            } else {
                                "No configurado".to_string()
                            }
                        })
                    }
                    Err(e) => serde_json::json!({ "configured": false, "status": "error", "description": e }),
                };

                // --- Backup ---
                // Check if a linker backup file exists
                let backup_status = match mt.query("/file/print", &[]) {
                    Ok(files) => {
                        let backups: Vec<&serde_json::Value> = files.iter()
                            .filter(|f| {
                                f.get("name").and_then(|v| v.as_str()).unwrap_or("")
                                    .starts_with("linker-backup")
                            }).collect();
                        let last = backups.last().and_then(|f| f.get("creation-time").and_then(|v| v.as_str()));
                        serde_json::json!({
                            "configured": !backups.is_empty(),
                            "status": if !backups.is_empty() { "ok" } else { "none" },
                            "files": backups.len(),
                            "description": if let Some(ts) = last {
                                format!("{} backups (ultimo: {})", backups.len(), ts)
                            } else if !backups.is_empty() {
                                format!("{} backups", backups.len())
                            } else {
                                "Sin backups".to_string()
                            }
                        })
                    }
                    Err(e) => serde_json::json!({ "configured": false, "status": "error", "description": e }),
                };

                // Compute overall score
                let modules = [&fw_status, &qos_status, &dns_status, &isolation_status, &ddos_status, &backup_status];
                let configured_count = modules.iter().filter(|m| {
                    m.get("configured").and_then(|v| v.as_bool()).unwrap_or(false)
                }).count();
                let health_pct = (configured_count as f64 / modules.len() as f64 * 100.0).round() as i64;

                Ok(serde_json::json!({
                    "connected": true,
                    "health_percentage": health_pct,
                    "configured_modules": configured_count,
                    "total_modules": modules.len(),
                    "firewall": fw_status,
                    "qos": qos_status,
                    "dns": dns_status,
                    "clientIsolation": isolation_status,
                    "antiDdos": ddos_status,
                    "backup": backup_status,
                }))
            }
            Err(e) => {
                println!("[SecurityHealth] Connection failed: {}", e);
                Ok(serde_json::json!({
                    "connected": false,
                    "health_percentage": 0,
                    "configured_modules": 0,
                    "total_modules": 6,
                    "error": format!("No se pudo conectar: {}", e),
                }))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// apply_security — applies rules to REAL MikroTik with "LK: " prefix
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn apply_security(db: State<'_, Database>, rule_type: String) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;

        let rules_applied: Vec<String>;
        let mut errors: Vec<String> = Vec::new();

        match client.connect() {
            Ok(mut mt_conn) => {
                rules_applied = match rule_type.as_str() {
                    "firewall" => apply_firewall_rules(&mut mt_conn, &mut errors),
                    "qos" => apply_qos_rules(&mut mt_conn, &mut errors),
                    "dns" => apply_dns_rules(&mut mt_conn, &mut errors),
                    "clientIsolation" => apply_client_isolation(&mut mt_conn, &mut errors),
                    "antiDdos" => apply_anti_ddos(&mut mt_conn, &mut errors),
                    "backup" => apply_backup(&mut mt_conn, &mut errors),
                    _ => {
                        errors.push(format!("Tipo de regla desconocido: {}", rule_type));
                        Vec::new()
                    }
                };
            }
            Err(e) => {
                log_to_db(&db_path, &format!("apply_security:{}", rule_type), "ERROR",
                    &format!("No se pudo conectar al MikroTik: {}", e), None);

                return Ok(serde_json::json!({
                    "success": false,
                    "message": format!("No se pudo conectar al MikroTik: {}", e),
                }));
            }
        }

        let status = if errors.is_empty() { "OK" } else if !rules_applied.is_empty() { "PARTIAL" } else { "ERROR" };
        let message = if errors.is_empty() {
            format!("{} reglas '{}' aplicadas correctamente", rules_applied.len(), rule_type)
        } else {
            format!("'{}': {} aplicadas, {} errores", rule_type, rules_applied.len(), errors.len())
        };

        let details = serde_json::json!({
            "rules_applied": rules_applied,
            "errors": errors,
        });

        log_to_db(&db_path, &format!("apply_security:{}", rule_type), status, &message,
            Some(&serde_json::to_string(&details).unwrap_or_default()));

        Ok(serde_json::json!({
            "success": errors.is_empty(),
            "message": message,
            "rules_applied": rules_applied,
            "errors": errors,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
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

/// Remove existing LK rules for a given module prefix before re-applying
fn remove_lk_rules(mt: &mut crate::mikrotik::MikroTikConnection, module: &str, errors: &mut Vec<String>) {
    let prefix = format!("LK: {}", module);
    println!("[Security] Removing existing '{}' rules...", prefix);
    match mt.get_firewall_filter() {
        Ok(rules) => {
            // Collect IDs to remove (reverse order to avoid index shifting)
            let ids: Vec<String> = rules.iter()
                .filter(|r| rule_comment(r).starts_with(&prefix))
                .filter_map(|r| r.get(".id").and_then(|v| v.as_str()).map(|s| s.to_string()))
                .collect();
            for id in ids.iter().rev() {
                if let Err(e) = mt.remove_firewall_filter(id) {
                    errors.push(format!("Error eliminando regla {}: {}", id, e));
                } else {
                    println!("[Security] Removed filter rule {}", id);
                }
            }
        }
        Err(e) => errors.push(format!("Error leyendo reglas: {}", e)),
    }
}

// ---------------------------------------------------------------------------
// FIREWALL
// ---------------------------------------------------------------------------
fn apply_firewall_rules(mt: &mut crate::mikrotik::MikroTikConnection, errors: &mut Vec<String>) -> Vec<String> {
    let mut applied = Vec::new();

    // Detect REAL subnets — never hardcode IPs
    let subnets = detect_subnets(mt);

    // Remove existing LK firewall rules first
    remove_lk_rules(mt, "firewall", errors);

    // Build rules dynamically based on detected subnets
    let mut rules: Vec<(String, Vec<String>)> = vec![
        // === INPUT chain ===
        ("INPUT: Accept established/related/untracked".into(), vec![
            "=chain=input".into(), "=action=accept".into(),
            "=connection-state=established,related,untracked".into(),
            "=comment=LK: firewall input accept-established".into(),
        ]),
        ("INPUT: Drop invalid".into(), vec![
            "=chain=input".into(), "=action=drop".into(),
            "=connection-state=invalid".into(),
            "=comment=LK: firewall input drop-invalid".into(),
        ]),
        ("INPUT: Accept ICMP (rate limited)".into(), vec![
            "=chain=input".into(), "=action=accept".into(),
            "=protocol=icmp".into(), "=limit=10,20:packet".into(),
            "=comment=LK: firewall input accept-icmp-limited".into(),
        ]),
    ];

    // Accept from LAN — use detected management subnet or interface list
    if !subnets.management_subnet.is_empty() {
        rules.push(("INPUT: Accept from LAN".into(), vec![
            "=chain=input".into(), "=action=accept".into(),
            format!("=src-address={}", subnets.management_subnet),
            "=comment=LK: firewall input accept-lan".into(),
        ]));
    } else {
        // Fallback: use interface list (works without knowing the subnet)
        rules.push(("INPUT: Accept from LAN".into(), vec![
            "=chain=input".into(), "=action=accept".into(),
            "=in-interface-list=LAN".into(),
            "=comment=LK: firewall input accept-lan".into(),
        ]));
    }

    rules.push(("INPUT: Accept WireGuard (UDP 13231)".into(), vec![
        "=chain=input".into(), "=action=accept".into(),
        "=protocol=udp".into(), "=dst-port=13231".into(),
        "=comment=LK: firewall input accept-wireguard".into(),
    ]));

    // Only add VPN API rule if VPN subnet detected
    if !subnets.vpn_subnet.is_empty() {
        rules.push(("INPUT: Accept API from VPN only".into(), vec![
            "=chain=input".into(), "=action=accept".into(),
            "=protocol=tcp".into(), "=dst-port=8728".into(),
            format!("=src-address={}", subnets.vpn_subnet),
            "=comment=LK: firewall input accept-api-vpn".into(),
        ]));
    }

    rules.push(("INPUT: Drop everything else".into(), vec![
        "=chain=input".into(), "=action=drop".into(),
        "=comment=LK: firewall input drop-all".into(),
    ]));

    // === FORWARD chain ===
    rules.extend(vec![
        ("FORWARD: Accept established/related/untracked".into(), vec![
            "=chain=forward".into(), "=action=accept".into(),
            "=connection-state=established,related,untracked".into(),
            "=comment=LK: firewall forward accept-established".into(),
        ]),
        ("FORWARD: Fasttrack established/related".into(), vec![
            "=chain=forward".into(), "=action=fasttrack-connection".into(),
            "=connection-state=established,related".into(),
            "=comment=LK: firewall forward fasttrack".into(),
        ]),
        ("FORWARD: Accept LAN to WAN".into(), vec![
            "=chain=forward".into(), "=action=accept".into(),
            "=in-interface-list=LAN".into(), "=out-interface-list=WAN".into(),
            "=comment=LK: firewall forward accept-lan-wan".into(),
        ]),
    ]);

    if !subnets.client_subnet.is_empty() {
        rules.push(("FORWARD: Drop client-to-client".into(), vec![
            "=chain=forward".into(), "=action=drop".into(),
            format!("=src-address={}", subnets.client_subnet),
            format!("=dst-address={}", subnets.client_subnet),
            "=comment=LK: firewall forward drop-client-to-client".into(),
        ]));
        if !subnets.management_subnet.is_empty() {
            rules.push(("FORWARD: Drop clients to management".into(), vec![
                "=chain=forward".into(), "=action=drop".into(),
                format!("=src-address={}", subnets.client_subnet),
                format!("=dst-address={}", subnets.management_subnet),
                "=comment=LK: firewall forward drop-client-to-mgmt".into(),
            ]));
        }
    }

    if !subnets.vpn_subnet.is_empty() {
        rules.push(("FORWARD: Accept VPN to LAN".into(), vec![
            "=chain=forward".into(), "=action=accept".into(),
            format!("=src-address={}", subnets.vpn_subnet),
            "=comment=LK: firewall forward accept-vpn-lan".into(),
        ]));
    }

    for (desc, args) in &rules {
        println!("[Firewall] Applying: {}", desc);
        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_firewall_filter(&args_ref) {
            Ok(_) => {
                println!("[Firewall] OK: {}", desc);
                applied.push(desc.to_string());
            }
            Err(e) => {
                println!("[Firewall] ERROR: {} -> {}", desc, e);
                errors.push(format!("{}: {}", desc, e));
            }
        }
    }

    applied
}

// ---------------------------------------------------------------------------
// QoS — PCQ queue types for fair distribution
// ---------------------------------------------------------------------------
fn apply_qos_rules(mt: &mut crate::mikrotik::MikroTikConnection, errors: &mut Vec<String>) -> Vec<String> {
    let mut applied = Vec::new();

    // Remove existing LK queue types
    println!("[QoS] Removing existing LK queue types...");
    if let Ok(types) = mt.query("/queue/type/print", &[]) {
        let ids: Vec<String> = types.iter()
            .filter(|t| is_lk_rule(t))
            .filter_map(|t| t.get(".id").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .collect();
        for id in ids.iter().rev() {
            mt.query("/queue/type/remove", &[&format!("=.id={}", id)]).ok();
        }
    }

    // Remove existing LK simple queues
    if let Ok(queues) = mt.get_queue_simple() {
        let ids: Vec<String> = queues.iter()
            .filter(|q| is_lk_rule(q))
            .filter_map(|q| q.get(".id").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .collect();
        for id in ids.iter().rev() {
            mt.query("/queue/simple/remove", &[&format!("=.id={}", id)]).ok();
        }
    }

    // Remove existing LK queue trees
    if let Ok(trees) = mt.get_queue_tree() {
        let ids: Vec<String> = trees.iter()
            .filter(|t| is_lk_rule(t))
            .filter_map(|t| t.get(".id").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .collect();
        for id in ids.iter().rev() {
            mt.query("/queue/tree/remove", &[&format!("=.id={}", id)]).ok();
        }
    }

    // Create PCQ download queue type
    println!("[QoS] Creating PCQ queue types...");
    match mt.query("/queue/type/add", &[
        "=name=LK-pcq-download",
        "=kind=pcq",
        "=pcq-rate=0",
        "=pcq-classifier=dst-address",
        "=comment=LK: qos pcq-download",
    ]) {
        Ok(_) => {
            println!("[QoS] OK: PCQ download type");
            applied.push("PCQ download type".to_string());
        }
        Err(e) => {
            println!("[QoS] ERROR PCQ download: {}", e);
            errors.push(format!("PCQ download type: {}", e));
        }
    }

    // Create PCQ upload queue type
    match mt.query("/queue/type/add", &[
        "=name=LK-pcq-upload",
        "=kind=pcq",
        "=pcq-rate=0",
        "=pcq-classifier=src-address",
        "=comment=LK: qos pcq-upload",
    ]) {
        Ok(_) => {
            println!("[QoS] OK: PCQ upload type");
            applied.push("PCQ upload type".to_string());
        }
        Err(e) => {
            println!("[QoS] ERROR PCQ upload: {}", e);
            errors.push(format!("PCQ upload type: {}", e));
        }
    }

    // Detect client subnet for queue target — never hardcode
    let subnets = detect_subnets(mt);
    let queue_target = if !subnets.client_subnet.is_empty() {
        subnets.client_subnet.clone()
    } else {
        "0.0.0.0/0".to_string()
    };
    println!("[QoS] Queue target subnet: {}", queue_target);

    let target_arg = format!("=target={}", queue_target);
    match mt.query("/queue/simple/add", &[
        "=name=LK-global-queue",
        &target_arg,
        "=queue=LK-pcq-upload/LK-pcq-download",
        "=comment=LK: qos global-queue",
    ]) {
        Ok(_) => {
            println!("[QoS] OK: Global queue");
            applied.push("Global PCQ queue".to_string());
        }
        Err(e) => {
            println!("[QoS] ERROR global queue: {}", e);
            errors.push(format!("Global queue: {}", e));
        }
    }

    applied
}

// ---------------------------------------------------------------------------
// DNS Cache
// ---------------------------------------------------------------------------
fn apply_dns_rules(mt: &mut crate::mikrotik::MikroTikConnection, errors: &mut Vec<String>) -> Vec<String> {
    let mut applied = Vec::new();

    println!("[DNS] Setting DNS servers and cache...");
    match mt.query("/ip/dns/set", &[
        "=servers=8.8.8.8,1.1.1.1",
        "=allow-remote-requests=yes",
        "=cache-size=4096",
    ]) {
        Ok(_) => {
            println!("[DNS] OK: DNS configured");
            applied.push("DNS: 8.8.8.8, 1.1.1.1 | cache: 4096KiB | remote: yes".to_string());
        }
        Err(e) => {
            println!("[DNS] ERROR: {}", e);
            errors.push(format!("DNS config: {}", e));
        }
    }

    applied
}

// ---------------------------------------------------------------------------
// Client Isolation
// ---------------------------------------------------------------------------
fn apply_client_isolation(mt: &mut crate::mikrotik::MikroTikConnection, errors: &mut Vec<String>) -> Vec<String> {
    let mut applied = Vec::new();

    // Detect REAL subnets — never hardcode
    let subnets = detect_subnets(mt);

    // Remove existing isolation rules
    remove_lk_rules(mt, "isolation", errors);

    if subnets.client_subnet.is_empty() {
        println!("[Isolation] No client subnet detected, skipping");
        return applied;
    }

    let desc = format!("Drop client-to-client ({})", subnets.client_subnet);
    let args: Vec<String> = vec![
        "=chain=forward".into(),
        "=action=drop".into(),
        format!("=src-address={}", subnets.client_subnet),
        format!("=dst-address={}", subnets.client_subnet),
        "=comment=LK: isolation drop-inter-client".into(),
    ];

    println!("[Isolation] Applying: {}", desc);
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    match mt.add_firewall_filter(&args_ref) {
        Ok(_) => {
            println!("[Isolation] OK: {}", desc);
            applied.push(desc);
        }
        Err(e) => {
            println!("[Isolation] ERROR: {} -> {}", desc, e);
            errors.push(format!("{}: {}", desc, e));
        }
    }

    applied
}

// ---------------------------------------------------------------------------
// Anti-DDoS
// ---------------------------------------------------------------------------
fn apply_anti_ddos(mt: &mut crate::mikrotik::MikroTikConnection, errors: &mut Vec<String>) -> Vec<String> {
    let mut applied = Vec::new();

    // Detect REAL subnets — never hardcode
    let subnets = detect_subnets(mt);

    // Remove existing antiddos rules
    remove_lk_rules(mt, "antiddos", errors);

    let mut rules: Vec<(String, Vec<String>)> = vec![
        ("SYN flood protection".into(), vec![
            "=chain=input".into(), "=action=drop".into(),
            "=protocol=tcp".into(), "=tcp-flags=syn".into(),
            "=connection-limit=100,32".into(),
            "=comment=LK: antiddos syn-flood-drop".into(),
        ]),
        ("Accept ICMP (rate limited)".into(), vec![
            "=chain=input".into(), "=action=accept".into(),
            "=protocol=icmp".into(), "=limit=10,20:packet".into(),
            "=comment=LK: antiddos icmp-accept-limited".into(),
        ]),
        ("Drop excess ICMP".into(), vec![
            "=chain=input".into(), "=action=drop".into(),
            "=protocol=icmp".into(),
            "=comment=LK: antiddos icmp-drop-excess".into(),
        ]),
    ];

    if !subnets.client_subnet.is_empty() {
        rules.push(("Connection limit per client".into(), vec![
            "=chain=forward".into(), "=action=drop".into(),
            "=protocol=tcp".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=connection-limit=200,32".into(),
            "=comment=LK: antiddos conn-limit-per-client".into(),
        ]));
    }

    for (desc, args) in &rules {
        println!("[AntiDDoS] Applying: {}", desc);
        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_firewall_filter(&args_ref) {
            Ok(_) => {
                println!("[AntiDDoS] OK: {}", desc);
                applied.push(desc.to_string());
            }
            Err(e) => {
                println!("[AntiDDoS] ERROR: {} -> {}", desc, e);
                errors.push(format!("{}: {}", desc, e));
            }
        }
    }

    applied
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------
fn apply_backup(mt: &mut crate::mikrotik::MikroTikConnection, errors: &mut Vec<String>) -> Vec<String> {
    let mut applied = Vec::new();

    let ts = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let name = format!("linker-backup-{}", ts);

    println!("[Backup] Creating backup: {}", name);
    match mt.query("/system/backup/save", &[
        &format!("=name={}", name),
    ]) {
        Ok(_) => {
            println!("[Backup] OK: {}", name);
            applied.push(format!("Backup: {}.backup", name));
        }
        Err(e) => {
            println!("[Backup] ERROR: {}", e);
            errors.push(format!("Backup: {}", e));
        }
    }

    applied
}

// ---------------------------------------------------------------------------
// get_rules — queries REAL MikroTik for firewall/NAT rules + DB log history
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn get_rules(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;

        let mut firewall_rules = Vec::new();
        let mut nat_rules = Vec::new();
        let mt_error;

        match client.connect() {
            Ok(mut mt) => {
                mt_error = None;

                // Firewall filter rules
                match mt.get_firewall_filter() {
                    Ok(rules) => {
                        for r in &rules {
                            let comment = rule_comment(r);
                            let is_linker = comment.starts_with(LK_PREFIX);
                            firewall_rules.push(serde_json::json!({
                                "id": r.get(".id").and_then(|v| v.as_str()).unwrap_or(""),
                                "chain": r.get("chain").and_then(|v| v.as_str()).unwrap_or(""),
                                "action": r.get("action").and_then(|v| v.as_str()).unwrap_or(""),
                                "src_address": r.get("src-address").and_then(|v| v.as_str()).unwrap_or(""),
                                "dst_address": r.get("dst-address").and_then(|v| v.as_str()).unwrap_or(""),
                                "protocol": r.get("protocol").and_then(|v| v.as_str()).unwrap_or(""),
                                "dst_port": r.get("dst-port").and_then(|v| v.as_str()).unwrap_or(""),
                                "connection_state": r.get("connection-state").and_then(|v| v.as_str()).unwrap_or(""),
                                "comment": comment,
                                "disabled": r.get("disabled").and_then(|v| v.as_str()).unwrap_or("false") == "true",
                                "is_linker": is_linker,
                                "type": "filter",
                            }));
                        }
                    }
                    Err(e) => println!("[Rules] Error reading filters: {}", e),
                }

                // NAT rules
                match mt.get_firewall_nat() {
                    Ok(rules) => {
                        for r in &rules {
                            let comment = rule_comment(r);
                            let is_linker = comment.starts_with(LK_PREFIX);
                            nat_rules.push(serde_json::json!({
                                "id": r.get(".id").and_then(|v| v.as_str()).unwrap_or(""),
                                "chain": r.get("chain").and_then(|v| v.as_str()).unwrap_or(""),
                                "action": r.get("action").and_then(|v| v.as_str()).unwrap_or(""),
                                "src_address": r.get("src-address").and_then(|v| v.as_str()).unwrap_or(""),
                                "dst_address": r.get("dst-address").and_then(|v| v.as_str()).unwrap_or(""),
                                "protocol": r.get("protocol").and_then(|v| v.as_str()).unwrap_or(""),
                                "dst_port": r.get("dst-port").and_then(|v| v.as_str()).unwrap_or(""),
                                "comment": comment,
                                "disabled": r.get("disabled").and_then(|v| v.as_str()).unwrap_or("false") == "true",
                                "is_linker": is_linker,
                                "type": "nat",
                            }));
                        }
                    }
                    Err(e) => println!("[Rules] Error reading NAT: {}", e),
                }
            }
            Err(e) => {
                mt_error = Some(e);
            }
        }

        // Also get DB history log
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let mut stmt = conn
            .prepare(
                "SELECT id, action, status, message, details, created_at
                 FROM network_logs
                 WHERE action LIKE 'apply_security%'
                 ORDER BY created_at DESC
                 LIMIT 50",
            )
            .map_err(|e| e.to_string())?;

        let history: Vec<serde_json::Value> = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "action": row.get::<_, String>(1)?,
                    "status": row.get::<_, String>(2)?,
                    "message": row.get::<_, String>(3)?,
                    "details": row.get::<_, Option<String>>(4)?,
                    "created_at": row.get::<_, String>(5)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(serde_json::json!({
            "connected": mt_error.is_none(),
            "error": mt_error,
            "firewall_rules": firewall_rules,
            "nat_rules": nat_rules,
            "total_filter": firewall_rules.len(),
            "total_nat": nat_rules.len(),
            "linker_filter": firewall_rules.iter().filter(|r| r.get("is_linker").and_then(|v| v.as_bool()).unwrap_or(false)).count(),
            "linker_nat": nat_rules.iter().filter(|r| r.get("is_linker").and_then(|v| v.as_bool()).unwrap_or(false)).count(),
            "history": history,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// audit_mikrotik — full audit (unchanged, already queries real MikroTik)
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn audit_mikrotik(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;

        let mut checks = Vec::new();

        match client.connect() {
            Ok(mut mt_conn) => {
                println!("[Audit] Connected to MikroTik, running audit...");

                let system = match mt_conn.get_system_resource() {
                    Ok(res) => {
                        checks.push(serde_json::json!({
                            "name": "System",
                            "status": "ok",
                            "description": format!("Version: {}, Board: {}",
                                res.get("version").and_then(|v| v.as_str()).unwrap_or("?"),
                                res.get("board-name").and_then(|v| v.as_str()).unwrap_or("?")),
                        }));
                        Some(res)
                    }
                    Err(e) => {
                        checks.push(serde_json::json!({
                            "name": "System", "status": "error", "description": e
                        }));
                        None
                    }
                };

                match mt_conn.get_identity() {
                    Ok(name) => {
                        checks.push(serde_json::json!({
                            "name": "Identity", "status": "ok", "description": name
                        }));
                    }
                    Err(e) => {
                        checks.push(serde_json::json!({
                            "name": "Identity", "status": "error", "description": e
                        }));
                    }
                }

                match mt_conn.get_interfaces() {
                    Ok(ifaces) => {
                        let running = ifaces.iter().filter(|i| i.get("running").and_then(|v| v.as_str()) == Some("true")).count();
                        checks.push(serde_json::json!({
                            "name": "Interfaces",
                            "status": "ok",
                            "description": format!("{} total, {} running", ifaces.len(), running),
                        }));
                    }
                    Err(e) => {
                        checks.push(serde_json::json!({
                            "name": "Interfaces", "status": "error", "description": e
                        }));
                    }
                }

                match mt_conn.get_firewall_filter() {
                    Ok(rules) => {
                        let lk = rules.iter().filter(|r| is_lk_rule(r)).count();
                        checks.push(serde_json::json!({
                            "name": "Firewall Filter",
                            "status": "ok",
                            "description": format!("{} reglas ({} Linker)", rules.len(), lk),
                        }));
                    }
                    Err(e) => {
                        checks.push(serde_json::json!({
                            "name": "Firewall Filter", "status": "error", "description": e
                        }));
                    }
                }

                match mt_conn.get_firewall_nat() {
                    Ok(rules) => {
                        checks.push(serde_json::json!({
                            "name": "Firewall NAT",
                            "status": "ok",
                            "description": format!("{} NAT rules", rules.len()),
                        }));
                    }
                    Err(e) => {
                        checks.push(serde_json::json!({
                            "name": "Firewall NAT", "status": "error", "description": e
                        }));
                    }
                }

                match mt_conn.get_dns() {
                    Ok(dns) => {
                        let servers = dns.first().and_then(|d| d.get("servers")).and_then(|v| v.as_str()).unwrap_or("?");
                        checks.push(serde_json::json!({
                            "name": "DNS",
                            "status": "ok",
                            "description": format!("Servers: {}", servers),
                        }));
                    }
                    Err(e) => {
                        checks.push(serde_json::json!({
                            "name": "DNS", "status": "error", "description": e
                        }));
                    }
                }

                match mt_conn.get_queue_simple() {
                    Ok(queues) => {
                        let lk = queues.iter().filter(|q| is_lk_rule(q)).count();
                        checks.push(serde_json::json!({
                            "name": "Simple Queues",
                            "status": "ok",
                            "description": format!("{} queues ({} Linker)", queues.len(), lk),
                        }));
                    }
                    Err(e) => {
                        checks.push(serde_json::json!({
                            "name": "Simple Queues", "status": "error", "description": e
                        }));
                    }
                }

                log_to_db(&db_path, "audit", "OK",
                    &format!("Auditoria completada: {} checks", checks.len()), None);

                Ok(serde_json::json!({
                    "success": true,
                    "system": system,
                    "checks": checks,
                }))
            }
            Err(e) => {
                println!("[Audit] Failed to connect: {}", e);
                log_to_db(&db_path, "audit", "ERROR",
                    &format!("Auditoria fallida: {}", e), None);

                Ok(serde_json::json!({
                    "success": false,
                    "message": format!("No se pudo conectar al MikroTik: {}", e),
                    "checks": [],
                }))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
