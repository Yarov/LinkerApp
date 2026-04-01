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

/// Read SSH credentials from DB settings, with fallback defaults
fn get_ssh_credentials(db_path: &std::path::Path) -> Vec<(String, String)> {
    let mut creds = Vec::new();
    if let Ok(conn) = rusqlite::Connection::open(db_path) {
        let user = get_setting(&conn, "antenna_ssh_user");
        let pass = get_setting(&conn, "antenna_ssh_password");
        if !user.is_empty() {
            creds.push((user, pass));
        }
    }
    creds.push(("ubnt".to_string(), "ubnt".to_string()));
    creds.push(("admin".to_string(), String::new()));
    creds.push(("admin".to_string(), "admin".to_string()));
    creds
}

#[tauri::command]
pub async fn list_nodes(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL;").ok();

        let nodes: Vec<serde_json::Value> = conn
            .prepare("SELECT id, name, type, ip, mac, parent_id, status, last_seen, created_at, updated_at FROM nodes ORDER BY name")
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
                        "last_seen": row.get::<_, Option<String>>(7)?,
                        "created_at": row.get::<_, String>(8)?,
                        "updated_at": row.get::<_, String>(9)?,
                    }))
                })?.filter_map(|r| r.ok()).collect();
                Ok(r)
            }).unwrap_or_default();

        Ok(serde_json::json!({ "nodes": nodes }))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_node(db: State<'_, Database>, name: String, node_type: Option<String>, ip: Option<String>, mac: Option<String>, parent_id: Option<String>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL;").ok();

        // Check for duplicate IP
        if let Some(ref node_ip) = ip {
            if !node_ip.is_empty() {
                let dup: bool = conn.query_row(
                    "SELECT COUNT(*) > 0 FROM nodes WHERE ip = ?1", [node_ip], |r| r.get(0)
                ).unwrap_or(false);
                if dup {
                    return Err(format!("Ya existe un nodo con la IP {}", node_ip));
                }
            }
        }

        // Check for duplicate name
        let dup_name: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM nodes WHERE name = ?1", [&name], |r| r.get(0)
        ).unwrap_or(false);
        if dup_name {
            return Err(format!("Ya existe un nodo con el nombre '{}'", name));
        }

        let id = gen_id();
        let ntype = node_type.unwrap_or_else(|| "CPE".to_string());
        conn.execute(
            "INSERT INTO nodes (id, name, type, ip, mac, parent_id, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'OFFLINE')",
            rusqlite::params![id, name, ntype, ip, mac, parent_id],
        ).map_err(|e| format!("Error creando nodo: {}", e))?;

        // Try to ping via MikroTik
        let mut reachable = false;
        if let Some(ref node_ip) = ip {
            let client = MikroTikClient::new(
                &get_setting(&conn, "mikrotik_host"),
                get_setting(&conn, "mikrotik_port").parse().unwrap_or(8728),
                &get_setting(&conn, "mikrotik_user"),
                &get_setting(&conn, "mikrotik_password"),
            );
            if let Ok(mut mt) = client.connect() {
                reachable = mt.ping_address(node_ip).unwrap_or(false);
                if reachable {
                    conn.execute("UPDATE nodes SET status = 'ONLINE', last_seen = datetime('now') WHERE id = ?1", [&id]).ok();
                }
            }
        }

        Ok(serde_json::json!({ "id": id, "reachable": reachable }))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_node(db: State<'_, Database>, id: String, name: String, node_type: Option<String>, ip: Option<String>, mac: Option<String>, parent_id: Option<String>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
        conn.execute(
            "UPDATE nodes SET name=?2, type=?3, ip=?4, mac=?5, parent_id=?6, updated_at=datetime('now') WHERE id=?1",
            rusqlite::params![id, name, node_type.unwrap_or("CPE".into()), ip, mac, parent_id],
        ).map_err(|e| format!("Error: {}", e))?;

        let mut reachable = false;
        if let Some(ref node_ip) = ip {
            let client = MikroTikClient::new(
                &get_setting(&conn, "mikrotik_host"),
                get_setting(&conn, "mikrotik_port").parse().unwrap_or(8728),
                &get_setting(&conn, "mikrotik_user"),
                &get_setting(&conn, "mikrotik_password"),
            );
            if let Ok(mut mt) = client.connect() {
                reachable = mt.ping_address(node_ip).unwrap_or(false);
                let status = if reachable { "ONLINE" } else { "OFFLINE" };
                conn.execute("UPDATE nodes SET status=?2, last_seen=CASE WHEN ?2='ONLINE' THEN datetime('now') ELSE last_seen END WHERE id=?1", rusqlite::params![id, status]).ok();
            }
        }

        Ok(serde_json::json!({ "success": true, "reachable": reachable }))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_node(db: State<'_, Database>, id: String) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL;").ok();

        let client_count: i64 = conn.query_row("SELECT COUNT(*) FROM clients WHERE node_id = ?1", [&id], |r| r.get(0)).unwrap_or(0);
        if client_count > 0 {
            return Err(format!("{} cliente(s) estan conectados a este nodo", client_count));
        }

        let child_count: i64 = conn.query_row("SELECT COUNT(*) FROM nodes WHERE parent_id = ?1", [&id], |r| r.get(0)).unwrap_or(0);
        if child_count > 0 {
            return Err(format!("{} nodo(s) hijo dependen de este nodo", child_count));
        }

        conn.execute("DELETE FROM nodes WHERE id = ?1", [&id]).map_err(|e| format!("Error: {}", e))?;
        Ok(serde_json::json!({ "success": true }))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_node_status(db: State<'_, Database>, id: String) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL;").ok();

        // Get node info
        let node: serde_json::Value = conn.query_row(
            "SELECT id, name, type, ip, mac, status, last_seen FROM nodes WHERE id = ?1", [&id],
            |row| Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "ip": row.get::<_, Option<String>>(3)?,
                "mac": row.get::<_, Option<String>>(4)?,
                "status": row.get::<_, String>(5)?,
                "last_seen": row.get::<_, Option<String>>(6)?,
            }))
        ).map_err(|_| "Nodo no encontrado".to_string())?;

        // Get child nodes
        let children: Vec<serde_json::Value> = conn.prepare("SELECT id, name, type, ip, status FROM nodes WHERE parent_id = ?1")
            .and_then(|mut s| {
                let r = s.query_map([&id], |row| {
                    Ok(serde_json::json!({
                        "id": row.get::<_, String>(0)?,
                        "name": row.get::<_, String>(1)?,
                        "type": row.get::<_, String>(2)?,
                        "ip": row.get::<_, Option<String>>(3)?,
                        "status": row.get::<_, String>(4)?,
                    }))
                })?.filter_map(|r| r.ok()).collect();
                Ok(r)
            }).unwrap_or_default();

        // Count DB clients assigned to this node
        let db_clients: i64 = conn.query_row("SELECT COUNT(*) FROM clients WHERE node_id = ?1", [&id], |r| r.get(0)).unwrap_or(0);

        // Try to get REAL connected devices from MikroTik
        let node_ip = node.get("ip").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let node_type = node.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let mut connected_devices: Vec<serde_json::Value> = Vec::new();
        let mut live_status: Option<serde_json::Value> = None;

        if !node_ip.is_empty() {
            let client = MikroTikClient::new(
                &get_setting(&conn, "mikrotik_host"),
                get_setting(&conn, "mikrotik_port").parse().unwrap_or(8728),
                &get_setting(&conn, "mikrotik_user"),
                &get_setting(&conn, "mikrotik_password"),
            );

            if let Ok(mut mt) = client.connect() {
                // Ping to verify online
                let is_online = mt.ping_address(&node_ip).unwrap_or(false);

                // For AP/DISTRIBUTION nodes: try SSH wstalist to get connected stations
                if (node_type == "AP" || node_type == "DISTRIBUTION") && is_online {
                    let ssh_creds = get_ssh_credentials(std::path::Path::new(&db_path));
                    let ssh_user = ssh_creds.first().map(|(u, _)| u.as_str()).unwrap_or("ubnt");
                    let ssh_pass = ssh_creds.first().map(|(_, p)| p.as_str()).unwrap_or("ubnt");
                    if let Ok((output, 0)) = mt.ssh_exec(&node_ip, ssh_user, ssh_pass, "wstalist") {
                        let clean = output.replace("\\n", "\n").replace("\\t", "");
                        if let Ok(stations) = serde_json::from_str::<Vec<serde_json::Value>>(&clean) {
                            for station in &stations {
                                let mac = station.get("mac").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let lastip = station.get("lastip").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let signal = station.get("signal").and_then(|v| v.as_i64()).unwrap_or(0);
                                let name = station.get("remote").and_then(|v| v.get("hostname")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let tx = station.get("tx").and_then(|v| v.as_f64()).unwrap_or(0.0);
                                let rx = station.get("rx").and_then(|v| v.as_f64()).unwrap_or(0.0);

                                connected_devices.push(serde_json::json!({
                                    "type": "station",
                                    "name": if name.is_empty() { mac.clone() } else { name },
                                    "mac": mac,
                                    "ip": lastip,
                                    "signal": signal,
                                    "tx_rate": tx,
                                    "rx_rate": rx,
                                }));
                            }
                            println!("[NodeStatus] {} stations connected to {}", stations.len(), node_ip);
                        }
                    }

                    // Also try mca-status for signal/frequency
                    if let Ok((output, 0)) = mt.ssh_exec(&node_ip, ssh_user, ssh_pass, "mca-status | head -20") {
                        let clean = output.replace("\\n", "\n");
                        let mut status_map = serde_json::Map::new();
                        for line in clean.lines() {
                            if let Some((k, v)) = line.split_once('=') {
                                status_map.insert(k.trim().to_string(), serde_json::Value::String(v.trim().to_string()));
                            }
                        }
                        if !status_map.is_empty() {
                            live_status = Some(serde_json::Value::Object(status_map));
                        }
                    }
                }

                // For any node: get DHCP leases that came through this node's subnet
                let dhcp = mt.get_dhcp_leases().unwrap_or_default();
                let arp = mt.get_arp_table().unwrap_or_default();

                // Find devices in DHCP that might be behind this node
                for lease in &dhcp {
                    let ip = lease.get("address").and_then(|v| v.as_str()).unwrap_or("");
                    let mac = lease.get("mac-address").and_then(|v| v.as_str()).unwrap_or("");
                    let hostname = lease.get("host-name").and_then(|v| v.as_str()).unwrap_or("");
                    if !ip.is_empty() && !hostname.is_empty() {
                        // Check if this device is NOT already a node
                        let is_node: bool = conn.query_row(
                            "SELECT COUNT(*) > 0 FROM nodes WHERE ip = ?1", [ip], |r| r.get(0)
                        ).unwrap_or(false);

                        if !is_node {
                            // Check if already in connected_devices
                            let already = connected_devices.iter().any(|d| d.get("mac").and_then(|v| v.as_str()) == Some(mac));
                            if !already {
                                connected_devices.push(serde_json::json!({
                                    "type": "client_device",
                                    "name": hostname,
                                    "mac": mac,
                                    "ip": ip,
                                }));
                            }
                        }
                    }
                }

                // Update node status in DB
                let status = if is_online { "ONLINE" } else { "OFFLINE" };
                conn.execute(
                    "UPDATE nodes SET status=?2, last_seen=CASE WHEN ?2='ONLINE' THEN datetime('now') ELSE last_seen END WHERE id=?1",
                    rusqlite::params![id, status]
                ).ok();
            }
        }

        println!("[NodeStatus] Node {} has {} connected devices, {} DB clients, {} children",
            node.get("name").and_then(|v| v.as_str()).unwrap_or("?"),
            connected_devices.len(), db_clients, children.len());

        Ok(serde_json::json!({
            "node": node,
            "children": children,
            "db_clients": db_clients,
            "connected_devices": connected_devices,
            "live_status": live_status,
        }))
    }).await.map_err(|e| e.to_string())?
}
