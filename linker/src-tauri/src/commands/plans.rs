use crate::db::Database;
use tauri::State;

fn gen_id() -> String {
    chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0).to_string()
}

#[tauri::command]
pub async fn list_plans(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let mut stmt = conn
            .prepare(
                "SELECT id, name, download_mbps, upload_mbps, price, profile_name, is_active, created_at
                 FROM plans ORDER BY name ASC",
            )
            .map_err(|e| e.to_string())?;

        let plans: Vec<serde_json::Value> = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "download_mbps": row.get::<_, i64>(2)?,
                    "upload_mbps": row.get::<_, i64>(3)?,
                    "price": row.get::<_, f64>(4)?,
                    "profile_name": row.get::<_, String>(5)?,
                    "is_active": row.get::<_, bool>(6)?,
                    "created_at": row.get::<_, String>(7)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(serde_json::json!({ "plans": plans }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_plan(
    db: State<'_, Database>,
    name: String,
    download_mbps: i64,
    upload_mbps: i64,
    price: f64,
    profile_name: String,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let id = gen_id();
        conn.execute(
            "INSERT INTO plans (id, name, download_mbps, upload_mbps, price, profile_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, name, download_mbps, upload_mbps, price, profile_name],
        )
        .map_err(|e| {
            if e.to_string().contains("UNIQUE") {
                "Error: El nombre de perfil ya existe".to_string()
            } else {
                format!("Error al crear plan: {}", e)
            }
        })?;

        Ok(serde_json::json!({ "success": true, "id": id }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_plan(
    db: State<'_, Database>,
    id: String,
    name: String,
    download_mbps: i64,
    upload_mbps: i64,
    price: f64,
    profile_name: String,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let updated = conn
            .execute(
                "UPDATE plans SET name=?2, download_mbps=?3, upload_mbps=?4, price=?5, profile_name=?6
                 WHERE id=?1",
                rusqlite::params![id, name, download_mbps, upload_mbps, price, profile_name],
            )
            .map_err(|e| format!("Error al actualizar plan: {}", e))?;

        if updated == 0 {
            return Err("Plan no encontrado".to_string());
        }

        Ok(serde_json::json!({ "success": true }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_plan(db: State<'_, Database>, id: String) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        // Check if any clients use this plan
        let profile: String = conn
            .query_row("SELECT profile_name FROM plans WHERE id = ?1", [&id], |row| {
                row.get(0)
            })
            .map_err(|_| "Plan no encontrado".to_string())?;

        let client_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clients WHERE profile_name = ?1",
                [&profile],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if client_count > 0 {
            return Err(format!(
                "No se puede eliminar: {} cliente(s) usan este plan",
                client_count
            ));
        }

        conn.execute("DELETE FROM plans WHERE id = ?1", [&id])
            .map_err(|e| format!("Error al eliminar plan: {}", e))?;

        Ok(serde_json::json!({ "success": true }))
    })
    .await
    .map_err(|e| e.to_string())?
}
