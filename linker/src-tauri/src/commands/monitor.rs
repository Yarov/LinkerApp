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

/// Check if there's already an unread NODE_DOWN alert for this node
fn has_unread_node_down(conn: &rusqlite::Connection, node_id: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM alerts WHERE node_id = ?1 AND type = 'NODE_DOWN' AND is_read = 0",
        [node_id],
        |row| row.get::<_, i64>(0),
    )
    .unwrap_or(0)
        > 0
}

/// Mark all unread NODE_DOWN alerts for this node as read (auto-resolve)
fn resolve_node_down_alerts(conn: &rusqlite::Connection, node_id: &str) {
    conn.execute(
        "UPDATE alerts SET is_read = 1 WHERE node_id = ?1 AND type = 'NODE_DOWN' AND is_read = 0",
        [node_id],
    )
    .ok();
}

/// Delete alerts older than 7 days
fn cleanup_old_alerts(conn: &rusqlite::Connection) {
    conn.execute(
        "DELETE FROM alerts WHERE created_at < datetime('now', '-7 days')",
        [],
    )
    .ok();
}

/// One-time startup cleanup: delete alert spam older than 1 day
fn startup_cleanup(conn: &rusqlite::Connection) {
    // Check if we already ran cleanup this session by looking at a sentinel
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM alerts", [], |row| row.get(0))
        .unwrap_or(0);

    if count > 50 {
        // Too many alerts = legacy spam, clean aggressively
        let deleted = conn
            .execute(
                "DELETE FROM alerts WHERE created_at < datetime('now', '-1 day')",
                [],
            )
            .unwrap_or(0);
        if deleted > 0 {
            println!("[Monitor] Limpieza inicial: {} alertas antiguas eliminadas", deleted);
        }
    }
}

/// Run monitoring sweep - pings nodes VIA MikroTik (not locally).
/// The Mac can't reach 192.168.1.x directly, but MikroTik can.
///
/// Smart alerting rules:
/// - NODE_DOWN only when node transitions from ONLINE -> OFFLINE (no duplicates)
/// - NODE_UP only when node was actually OFFLINE and comes back
/// - Auto-resolves NODE_DOWN alerts when node recovers
/// - Cleans up alerts older than 7 days
#[tauri::command]
pub async fn run_monitor(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        // Startup cleanup on first run (safe to call multiple times, only acts when needed)
        startup_cleanup(&conn);

        // Get all nodes with IPs
        let nodes: Vec<(String, String, String, String)> = conn
            .prepare("SELECT id, name, ip, status FROM nodes WHERE ip IS NOT NULL AND ip != ''")
            .and_then(|mut s| {
                let r = s.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?))
                })?.filter_map(|r| r.ok()).collect();
                Ok(r)
            }).unwrap_or_default();

        if nodes.is_empty() {
            return Ok(serde_json::json!({ "scanned": 0, "new_alerts": 0, "results": [] }));
        }

        // Connect to MikroTik to do pings from there
        let client = MikroTikClient::new(
            &get_setting(&conn, "mikrotik_host"),
            get_setting(&conn, "mikrotik_port").parse().unwrap_or(8728),
            &get_setting(&conn, "mikrotik_user"),
            &get_setting(&conn, "mikrotik_password"),
        );

        let mk_host = get_setting(&conn, "mikrotik_host");
        let mut mt_conn_opt = client.connect().ok();

        let mut results = Vec::new();
        let mut new_alerts = 0;

        for (id, name, ip, old_status) in &nodes {
            let is_online = if ip == &mk_host {
                // MikroTik itself - if we connected, it's online
                mt_conn_opt.is_some()
            } else if let Some(ref mut mt) = mt_conn_opt {
                // Ping via MikroTik
                mt.ping_address(ip).unwrap_or(false)
            } else {
                // No MikroTik connection - try local ping as fallback
                std::process::Command::new("ping")
                    .args(["-c", "1", "-W", "2", ip])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            };

            let new_status = if is_online { "ONLINE" } else { "OFFLINE" };

            // Update node status and last_seen
            conn.execute(
                "UPDATE nodes SET status = ?2, last_seen = CASE WHEN ?2 = 'ONLINE' THEN datetime('now') ELSE last_seen END, updated_at = datetime('now') WHERE id = ?1",
                rusqlite::params![id, new_status],
            ).ok();

            // --- Smart alerting logic ---

            if is_online && old_status == "OFFLINE" {
                // Node recovered: was OFFLINE, now ONLINE
                // Only create NODE_UP if there was an unread NODE_DOWN
                if has_unread_node_down(&conn, id) {
                    conn.execute(
                        "INSERT INTO alerts (id, node_id, type, message, created_at) VALUES (?1, ?2, 'NODE_UP', ?3, datetime('now'))",
                        rusqlite::params![gen_id(), id, format!("{} se recupero", name)],
                    ).ok();
                    new_alerts += 1;
                }
                // Auto-resolve all NODE_DOWN alerts for this node
                resolve_node_down_alerts(&conn, id);
            } else if !is_online && old_status == "ONLINE" {
                // Node went down: was ONLINE, now OFFLINE
                // Only create alert if there isn't already an unread NODE_DOWN
                if !has_unread_node_down(&conn, id) {
                    conn.execute(
                        "INSERT INTO alerts (id, node_id, type, message, created_at) VALUES (?1, ?2, 'NODE_DOWN', ?3, datetime('now'))",
                        rusqlite::params![gen_id(), id, format!("{} se desconecto", name)],
                    ).ok();
                    new_alerts += 1;
                }
            }
            // If was ONLINE and still ONLINE -> do nothing (no spam)
            // If was OFFLINE and still OFFLINE -> do nothing (no duplicate)

            results.push(serde_json::json!({
                "name": name, "ip": ip, "old_status": old_status, "new_status": new_status,
            }));
        }

        // Periodic cleanup: remove alerts older than 7 days
        cleanup_old_alerts(&conn);

        let online = results.iter().filter(|r| r["new_status"] == "ONLINE").count();
        println!("[Monitor] {}/{} nodos en linea, {} alertas nuevas", online, results.len(), new_alerts);

        Ok(serde_json::json!({
            "scanned": results.len(),
            "online": online,
            "offline": results.len() - online,
            "new_alerts": new_alerts,
            "results": results,
        }))
    }).await.map_err(|e| e.to_string())?
}
