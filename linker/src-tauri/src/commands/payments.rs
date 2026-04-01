use crate::db::Database;
use tauri::State;

fn gen_id() -> String {
    chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0).to_string()
}

#[tauri::command]
pub async fn list_payments(
    db: State<'_, Database>,
    month: Option<String>,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let period = month.unwrap_or_else(|| chrono::Utc::now().format("%Y-%m").to_string());

        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.client_id, p.amount, p.period, p.method, p.notes, p.paid_at, p.created_at,
                        c.name as client_name
                 FROM payments p
                 JOIN clients c ON c.id = p.client_id
                 WHERE p.period = ?1
                 ORDER BY p.paid_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let payments: Vec<serde_json::Value> = stmt
            .query_map([&period], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "client_id": row.get::<_, String>(1)?,
                    "amount": row.get::<_, f64>(2)?,
                    "period": row.get::<_, String>(3)?,
                    "method": row.get::<_, String>(4)?,
                    "notes": row.get::<_, Option<String>>(5)?,
                    "paid_at": row.get::<_, String>(6)?,
                    "created_at": row.get::<_, String>(7)?,
                    "client_name": row.get::<_, String>(8)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        // Summary
        let total: f64 = payments.iter().map(|p| p["amount"].as_f64().unwrap_or(0.0)).sum();

        // Count clients who have NOT paid this month
        let total_active: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clients WHERE status = 'ACTIVE'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let paid_count = payments.len() as i64;
        let pending_count = total_active - paid_count;

        Ok(serde_json::json!({
            "payments": payments,
            "total": total,
            "paid_count": paid_count,
            "pending_count": if pending_count > 0 { pending_count } else { 0 },
            "period": period,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_payment(
    db: State<'_, Database>,
    client_id: String,
    amount: f64,
    period: String,
    method: Option<String>,
    notes: Option<String>,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let id = gen_id();
        let pay_method = method.unwrap_or_else(|| "EFECTIVO".to_string());

        // Verify client exists
        let _: String = conn
            .query_row(
                "SELECT id FROM clients WHERE id = ?1",
                [&client_id],
                |row| row.get(0),
            )
            .map_err(|_| "Cliente no encontrado".to_string())?;

        conn.execute(
            "INSERT INTO payments (id, client_id, amount, period, method, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, client_id, amount, period, pay_method, notes],
        )
        .map_err(|e| format!("Error al registrar pago: {}", e))?;

        Ok(serde_json::json!({ "success": true, "id": id }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_payment(db: State<'_, Database>, id: String) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let deleted = conn
            .execute("DELETE FROM payments WHERE id = ?1", [&id])
            .map_err(|e| format!("Error al eliminar pago: {}", e))?;

        if deleted == 0 {
            return Err("Pago no encontrado".to_string());
        }

        Ok(serde_json::json!({ "success": true }))
    })
    .await
    .map_err(|e| e.to_string())?
}
