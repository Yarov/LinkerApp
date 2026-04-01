use crate::db::Database;
use crate::mikrotik::MikroTikClient;
use tauri::State;

fn get_setting(conn: &rusqlite::Connection, key: &str) -> String {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .unwrap_or_default()
}

fn make_client(conn: &rusqlite::Connection) -> MikroTikClient {
    let host = get_setting(conn, "mikrotik_host");
    let port: u16 = get_setting(conn, "mikrotik_port").parse().unwrap_or(8728);
    let user = get_setting(conn, "mikrotik_user");
    let password = get_setting(conn, "mikrotik_password");
    MikroTikClient::new(&host, port, &user, &password)
}

#[tauri::command]
pub async fn health_check(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let client = make_client(&conn);
        let host = client.host.clone();
        let port = client.port;

        // Drop the DB connection before doing network I/O
        drop(conn);

        let start = std::time::Instant::now();
        match client.connect() {
            Ok(mut mt_conn) => {
                let latency = start.elapsed().as_millis();
                match mt_conn.get_system_resource() {
                    Ok(resource) => {
                        let version = resource.get("version").and_then(|v| v.as_str()).unwrap_or("unknown");
                        let board = resource.get("board-name").and_then(|v| v.as_str()).unwrap_or("unknown");
                        let uptime = resource.get("uptime").and_then(|v| v.as_str()).unwrap_or("unknown");
                        println!("[MikroTik] Health OK: {} {} uptime={}", board, version, uptime);

                        Ok(serde_json::json!({
                            "connected": true,
                            "authenticated": true,
                            "host": host,
                            "port": port,
                            "latency": latency,
                            "version": version,
                            "board": board,
                            "uptime": uptime,
                        }))
                    }
                    Err(e) => {
                        println!("[MikroTik] Connected but query failed: {}", e);
                        Ok(serde_json::json!({
                            "connected": true,
                            "authenticated": true,
                            "host": host,
                            "port": port,
                            "latency": latency,
                            "error": format!("Query failed: {}", e),
                        }))
                    }
                }
            }
            Err(e) => {
                let latency = start.elapsed().as_millis();
                println!("[MikroTik] Health check failed: {}", e);
                Ok(serde_json::json!({
                    "connected": false,
                    "authenticated": false,
                    "host": host,
                    "port": port,
                    "latency": latency,
                    "error": e,
                }))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_system_status(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let client = make_client(&conn);
        let host = client.host.clone();
        let port = client.port;

        // Drop the DB connection before doing network I/O
        drop(conn);

        let start = std::time::Instant::now();
        match client.connect() {
            Ok(mut mt_conn) => {
                let latency = start.elapsed().as_millis();

                let resource = mt_conn.get_system_resource().unwrap_or(serde_json::Value::Null);
                let identity = mt_conn.get_identity().unwrap_or_else(|_| "unknown".to_string());

                Ok(serde_json::json!({
                    "connected": true,
                    "host": host,
                    "port": port,
                    "latency": latency,
                    "identity": identity,
                    "resource": resource,
                }))
            }
            Err(e) => {
                let latency = start.elapsed().as_millis();
                Ok(serde_json::json!({
                    "connected": false,
                    "host": host,
                    "port": port,
                    "latency": latency,
                    "resource": null,
                    "error": e,
                }))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_pppoe_sessions(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let client = make_client(&conn);

        // Drop the DB connection before doing network I/O
        drop(conn);

        match client.connect() {
            Ok(mut mt_conn) => {
                let active = mt_conn.get_pppoe_active().unwrap_or_default();
                let count = active.len();
                println!("[MikroTik] PPPoE active sessions: {}", count);

                Ok(serde_json::json!({
                    "sessions": active,
                    "count": count,
                }))
            }
            Err(e) => {
                println!("[MikroTik] Failed to get PPPoE sessions: {}", e);
                Ok(serde_json::json!({
                    "sessions": [],
                    "count": 0,
                    "error": e,
                }))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
