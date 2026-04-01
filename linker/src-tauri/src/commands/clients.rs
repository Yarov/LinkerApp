use crate::db::Database;
use crate::mikrotik::MikroTikClient;
use tauri::State;

fn get_setting(conn: &rusqlite::Connection, key: &str) -> String {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .unwrap_or_default()
}

fn gen_id() -> String {
    chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0).to_string()
}

#[tauri::command]
pub async fn list_clients(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let mut stmt = conn
            .prepare(
                "SELECT c.id, c.name, c.phone, c.address, c.status, c.pppoe_user, c.pppoe_password,
                        c.profile_name, c.node_id, c.notes, c.created_at, c.updated_at,
                        COALESCE(p.name, '') as plan_name,
                        COALESCE(p.download_mbps, 0) as download_mbps,
                        COALESCE(p.upload_mbps, 0) as upload_mbps,
                        COALESCE(p.price, 0) as price
                 FROM clients c
                 LEFT JOIN plans p ON p.profile_name = c.profile_name
                 ORDER BY c.name ASC",
            )
            .map_err(|e| e.to_string())?;

        let clients: Vec<serde_json::Value> = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "phone": row.get::<_, Option<String>>(2)?,
                    "address": row.get::<_, String>(3)?,
                    "status": row.get::<_, String>(4)?,
                    "pppoe_user": row.get::<_, String>(5)?,
                    "pppoe_password": row.get::<_, String>(6)?,
                    "profile_name": row.get::<_, String>(7)?,
                    "node_id": row.get::<_, Option<String>>(8)?,
                    "notes": row.get::<_, Option<String>>(9)?,
                    "created_at": row.get::<_, String>(10)?,
                    "updated_at": row.get::<_, String>(11)?,
                    "plan_name": row.get::<_, String>(12)?,
                    "download_mbps": row.get::<_, i64>(13)?,
                    "upload_mbps": row.get::<_, i64>(14)?,
                    "price": row.get::<_, f64>(15)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(serde_json::json!({ "clients": clients }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_client(
    db: State<'_, Database>,
    name: String,
    phone: Option<String>,
    address: String,
    pppoe_user: String,
    pppoe_password: String,
    profile_name: String,
    node_id: Option<String>,
    notes: Option<String>,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let id = gen_id();
        conn.execute(
            "INSERT INTO clients (id, name, phone, address, pppoe_user, pppoe_password, profile_name, node_id, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![id, name, phone, address, pppoe_user, pppoe_password, profile_name, node_id, notes],
        )
        .map_err(|e| {
            if e.to_string().contains("UNIQUE") {
                "Error: El usuario PPPoE ya existe".to_string()
            } else {
                format!("Error al crear cliente: {}", e)
            }
        })?;

        // Also create PPPoE secret on MikroTik
        let mt_client = MikroTikClient::new(
            &get_setting(&conn, "mikrotik_host"),
            get_setting(&conn, "mikrotik_port").parse().unwrap_or(8728),
            &get_setting(&conn, "mikrotik_user"),
            &get_setting(&conn, "mikrotik_password"),
        );
        drop(conn);

        let mut mt_error: Option<String> = None;
        match mt_client.connect() {
            Ok(mut mt_conn) => {
                if let Err(e) = mt_conn.create_pppoe_secret(&pppoe_user, &pppoe_password, &profile_name) {
                    mt_error = Some(format!("Cliente creado en BD, pero fallo en MikroTik: {}", e));
                    println!("[Client] MikroTik PPPoE create failed: {}", e);
                } else {
                    println!("[Client] PPPoE secret created on MikroTik: {}", pppoe_user);
                }
            }
            Err(e) => {
                mt_error = Some(format!("Cliente creado en BD, pero no se pudo conectar a MikroTik: {}", e));
                println!("[Client] MikroTik connection failed: {}", e);
            }
        }

        if let Some(warning) = mt_error {
            Ok(serde_json::json!({ "success": true, "id": id, "warning": warning }))
        } else {
            Ok(serde_json::json!({ "success": true, "id": id }))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_client(
    db: State<'_, Database>,
    id: String,
    name: String,
    phone: Option<String>,
    address: String,
    pppoe_user: String,
    pppoe_password: String,
    profile_name: String,
    node_id: Option<String>,
    notes: Option<String>,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let updated = conn
            .execute(
                "UPDATE clients SET name=?2, phone=?3, address=?4, pppoe_user=?5, pppoe_password=?6,
                 profile_name=?7, node_id=?8, notes=?9, updated_at=datetime('now')
                 WHERE id=?1",
                rusqlite::params![id, name, phone, address, pppoe_user, pppoe_password, profile_name, node_id, notes],
            )
            .map_err(|e| format!("Error al actualizar cliente: {}", e))?;

        if updated == 0 {
            return Err("Cliente no encontrado".to_string());
        }

        Ok(serde_json::json!({ "success": true }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_client(db: State<'_, Database>, id: String) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        // Get pppoe_user before deleting
        let pppoe_user: Option<String> = conn
            .query_row("SELECT pppoe_user FROM clients WHERE id = ?1", [&id], |row| row.get(0))
            .ok();

        let deleted = conn
            .execute("DELETE FROM clients WHERE id = ?1", [&id])
            .map_err(|e| format!("Error al eliminar cliente: {}", e))?;

        if deleted == 0 {
            return Err("Cliente no encontrado".to_string());
        }

        // Also remove PPPoE secret from MikroTik
        if let Some(ref user) = pppoe_user {
            let mt_client = MikroTikClient::new(
                &get_setting(&conn, "mikrotik_host"),
                get_setting(&conn, "mikrotik_port").parse().unwrap_or(8728),
                &get_setting(&conn, "mikrotik_user"),
                &get_setting(&conn, "mikrotik_password"),
            );
            drop(conn);

            match mt_client.connect() {
                Ok(mut mt_conn) => {
                    if let Err(e) = mt_conn.delete_pppoe_secret(user) {
                        println!("[Client] MikroTik delete PPPoE failed for {}: {}", user, e);
                    } else {
                        println!("[Client] MikroTik PPPoE secret deleted: {}", user);
                    }
                }
                Err(e) => {
                    println!("[Client] MikroTik connection failed on delete: {}", e);
                }
            }
        }

        Ok(serde_json::json!({ "success": true }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn toggle_client(db: State<'_, Database>, id: String) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let (current_status, pppoe_user): (String, String) = conn
            .query_row("SELECT status, pppoe_user FROM clients WHERE id = ?1", [&id], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(|_| "Cliente no encontrado".to_string())?;

        let new_status = if current_status == "ACTIVE" {
            "SUSPENDED"
        } else {
            "ACTIVE"
        };

        conn.execute(
            "UPDATE clients SET status = ?2, updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![id, new_status],
        )
        .map_err(|e| format!("Error al cambiar estado: {}", e))?;

        // Sync to MikroTik
        let mt_client = MikroTikClient::new(
            &get_setting(&conn, "mikrotik_host"),
            get_setting(&conn, "mikrotik_port").parse().unwrap_or(8728),
            &get_setting(&conn, "mikrotik_user"),
            &get_setting(&conn, "mikrotik_password"),
        );
        drop(conn);

        let mut mt_warning: Option<String> = None;
        match mt_client.connect() {
            Ok(mut mt_conn) => {
                let result = if new_status == "SUSPENDED" {
                    mt_conn.disable_pppoe_secret(&pppoe_user)
                } else {
                    mt_conn.enable_pppoe_secret(&pppoe_user)
                };
                if let Err(e) = result {
                    mt_warning = Some(format!("Estado cambiado en BD, pero fallo en MikroTik: {}", e));
                    println!("[Client] MikroTik toggle failed for {}: {}", pppoe_user, e);
                } else {
                    println!("[Client] MikroTik PPPoE {} -> {}", pppoe_user, if new_status == "SUSPENDED" { "disabled" } else { "enabled" });
                }
            }
            Err(e) => {
                mt_warning = Some(format!("Estado cambiado en BD, pero no se pudo conectar a MikroTik: {}", e));
                println!("[Client] MikroTik connection failed: {}", e);
            }
        }

        let mut result = serde_json::json!({ "success": true, "new_status": new_status });
        if let Some(w) = mt_warning {
            result["warning"] = serde_json::Value::String(w);
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
