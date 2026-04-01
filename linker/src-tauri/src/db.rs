use rusqlite::Connection;
use std::path::PathBuf;
use tauri::Manager;

/// Stores the database path. Each command opens its own connection.
/// This avoids Mutex contention - SQLite handles concurrent access via WAL mode.
pub struct Database {
    pub path: PathBuf,
}

impl Database {
    /// Open a new connection to the database
    pub fn connect(&self) -> Result<Connection, String> {
        let conn = Connection::open(&self.path).map_err(|e| format!("DB error: {}", e))?;
        // Enable WAL mode for concurrent reads
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
            .map_err(|e| format!("DB pragma error: {}", e))?;
        Ok(conn)
    }
}

pub fn init_database(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_dir)?;
    let db_path = app_dir.join("linker.db");

    // Initialize schema with a temporary connection
    let conn = Connection::open(&db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")?;

    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS plans (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            download_mbps INTEGER NOT NULL,
            upload_mbps INTEGER NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            profile_name TEXT NOT NULL UNIQUE,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'CPE',
            ip TEXT,
            mac TEXT,
            model TEXT,
            firmware TEXT,
            latitude REAL,
            longitude REAL,
            parent_id TEXT REFERENCES nodes(id),
            status TEXT NOT NULL DEFAULT 'OFFLINE',
            last_seen TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS clients (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT,
            address TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            pppoe_user TEXT NOT NULL UNIQUE,
            pppoe_password TEXT NOT NULL,
            profile_name TEXT NOT NULL,
            node_id TEXT REFERENCES nodes(id),
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS payments (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            amount REAL NOT NULL,
            period TEXT NOT NULL,
            method TEXT NOT NULL DEFAULT 'EFECTIVO',
            notes TEXT,
            paid_at TEXT NOT NULL DEFAULT (datetime('now')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,
            node_id TEXT REFERENCES nodes(id),
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            is_read INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS network_logs (
            id TEXT PRIMARY KEY,
            action TEXT NOT NULL,
            status TEXT NOT NULL,
            message TEXT NOT NULL,
            details TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    ")?;

    // Seed defaults
    for (k, v) in [
        ("admin_user", "admin"), ("admin_password", "linker2026"),
        ("mikrotik_host", "10.10.10.3"), ("mikrotik_port", "8728"),
        ("mikrotik_user", "admin"), ("mikrotik_password", ""),
        ("isp_type", "other"), // "starlink", "izzi", "telmex", "other"
    ] {
        conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)", [k, v])?;
    }

    drop(conn); // Close init connection

    app.manage(Database { path: db_path.clone() });
    println!("Database initialized at {:?} (WAL mode)", db_path);
    Ok(())
}
