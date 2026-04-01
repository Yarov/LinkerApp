use crate::db::Database;
use tauri::State;

#[tauri::command]
pub async fn get_dashboard(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

        let total_clients: i64 = conn
            .query_row("SELECT COUNT(*) FROM clients", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;

        let active_clients: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clients WHERE status = 'ACTIVE'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let suspended_clients: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clients WHERE status = 'SUSPENDED'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let total_nodes: i64 = conn
            .query_row("SELECT COUNT(*) FROM nodes", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;

        let online_nodes: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM nodes WHERE status = 'ONLINE'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let total_plans: i64 = conn
            .query_row("SELECT COUNT(*) FROM plans", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;

        let current_month = chrono::Utc::now().format("%Y-%m").to_string();
        let monthly_revenue: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE period = ?1",
                [&current_month],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let unread_alerts: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM alerts WHERE is_read = 0",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        // Recent payments (last 10)
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.amount, p.period, p.method, p.paid_at, c.name as client_name
                 FROM payments p
                 JOIN clients c ON c.id = p.client_id
                 ORDER BY p.paid_at DESC
                 LIMIT 10",
            )
            .map_err(|e| e.to_string())?;

        let recent_payments: Vec<serde_json::Value> = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "amount": row.get::<_, f64>(1)?,
                    "period": row.get::<_, String>(2)?,
                    "method": row.get::<_, String>(3)?,
                    "paid_at": row.get::<_, String>(4)?,
                    "client_name": row.get::<_, String>(5)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(serde_json::json!({
            "total_clients": total_clients,
            "active_clients": active_clients,
            "suspended_clients": suspended_clients,
            "total_nodes": total_nodes,
            "online_nodes": online_nodes,
            "total_plans": total_plans,
            "monthly_revenue": monthly_revenue,
            "unread_alerts": unread_alerts,
            "recent_payments": recent_payments,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
