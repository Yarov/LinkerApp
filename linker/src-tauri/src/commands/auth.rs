use crate::db::Database;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub async fn login(
    db: State<'_, Database>,
    username: String,
    password: String,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let stored_user: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'admin_user'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let stored_pass: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'admin_password'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if username == stored_user && password == stored_pass {
            let mut hasher = Sha256::new();
            hasher.update(&stored_pass);
            let hash = hex::encode(hasher.finalize());
            Ok(serde_json::json!({ "success": true, "token": hash }))
        } else {
            Ok(serde_json::json!({ "success": false, "error": "Credenciales incorrectas" }))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn logout() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn check_session(db: State<'_, Database>, token: String) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let stored_pass: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'admin_password'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let mut hasher = Sha256::new();
        hasher.update(&stored_pass);
        let expected = hex::encode(hasher.finalize());

        Ok(serde_json::json!({ "valid": token == expected }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_settings(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let mut stmt = conn
            .prepare("SELECT key, value FROM settings")
            .map_err(|e| e.to_string())?;

        let settings: HashMap<String, String> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<HashMap<_, _>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(serde_json::json!({ "settings": settings }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_settings(
    db: State<'_, Database>,
    settings: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        // Only allow known setting keys
        let allowed_keys = [
            "mikrotik_host", "mikrotik_port", "mikrotik_user", "mikrotik_password",
            "admin_user", "admin_password",
            "isp_type", "wan_lines",
        ];

        let mut saved = 0;
        for (key, value) in &settings {
            if !allowed_keys.contains(&key.as_str()) {
                continue;
            }
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                rusqlite::params![key, value],
            ).map_err(|e| format!("Error al guardar '{}': {}", key, e))?;
            saved += 1;
        }

        Ok(serde_json::json!({ "success": true, "saved": saved }))
    })
    .await
    .map_err(|e| e.to_string())?
}
