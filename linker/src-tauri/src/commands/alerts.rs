use crate::db::Database;
use tauri::State;

#[tauri::command]
pub async fn list_alerts(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let mut stmt = conn
            .prepare(
                "SELECT a.id, a.node_id, a.type, a.message, a.is_read, a.created_at,
                        COALESCE(n.name, '') as node_name
                 FROM alerts a
                 LEFT JOIN nodes n ON n.id = a.node_id
                 ORDER BY a.created_at DESC
                 LIMIT 200",
            )
            .map_err(|e| e.to_string())?;

        let alerts: Vec<serde_json::Value> = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "node_id": row.get::<_, Option<String>>(1)?,
                    "type": row.get::<_, String>(2)?,
                    "message": row.get::<_, String>(3)?,
                    "is_read": row.get::<_, bool>(4)?,
                    "created_at": row.get::<_, String>(5)?,
                    "node_name": row.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let unread_count = alerts.iter().filter(|a| !a["is_read"].as_bool().unwrap_or(true)).count();

        // Summary counts for unread alerts
        let down_count = alerts.iter().filter(|a| {
            !a["is_read"].as_bool().unwrap_or(true) && a["type"].as_str() == Some("NODE_DOWN")
        }).count();
        let up_count = alerts.iter().filter(|a| {
            !a["is_read"].as_bool().unwrap_or(true) && a["type"].as_str() == Some("NODE_UP")
        }).count();

        Ok(serde_json::json!({
            "alerts": alerts,
            "unread_count": unread_count,
            "down_count": down_count,
            "up_count": up_count,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mark_alert_read(db: State<'_, Database>, id: String) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let updated = conn
            .execute(
                "UPDATE alerts SET is_read = 1 WHERE id = ?1",
                [&id],
            )
            .map_err(|e| format!("Error al marcar alerta: {}", e))?;

        if updated == 0 {
            return Err("Alerta no encontrada".to_string());
        }

        Ok(serde_json::json!({ "success": true }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mark_all_alerts_read(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let updated = conn
            .execute("UPDATE alerts SET is_read = 1 WHERE is_read = 0", [])
            .map_err(|e| format!("Error: {}", e))?;

        Ok(serde_json::json!({ "success": true, "updated": updated }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_read_alerts(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let deleted = conn
            .execute("DELETE FROM alerts WHERE is_read = 1", [])
            .map_err(|e| format!("Error: {}", e))?;

        Ok(serde_json::json!({ "success": true, "deleted": deleted }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Get recent unread alerts for the dashboard (max 5)
#[tauri::command]
pub async fn get_recent_alerts(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let mut stmt = conn
            .prepare(
                "SELECT a.id, a.node_id, a.type, a.message, a.is_read, a.created_at,
                        COALESCE(n.name, '') as node_name
                 FROM alerts a
                 LEFT JOIN nodes n ON n.id = a.node_id
                 WHERE a.is_read = 0
                 ORDER BY a.created_at DESC
                 LIMIT 5",
            )
            .map_err(|e| e.to_string())?;

        let alerts: Vec<serde_json::Value> = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "node_id": row.get::<_, Option<String>>(1)?,
                    "type": row.get::<_, String>(2)?,
                    "message": row.get::<_, String>(3)?,
                    "is_read": row.get::<_, bool>(4)?,
                    "created_at": row.get::<_, String>(5)?,
                    "node_name": row.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(serde_json::json!({ "alerts": alerts }))
    })
    .await
    .map_err(|e| e.to_string())?
}
