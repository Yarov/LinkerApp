#[cfg(not(debug_assertions))]
use tauri::Manager;

#[cfg(not(debug_assertions))]
use std::net::TcpStream;
#[cfg(not(debug_assertions))]
use std::process::{Child, Command};
#[cfg(not(debug_assertions))]
use std::sync::Mutex;
#[cfg(not(debug_assertions))]
use std::time::Duration;

#[cfg(not(debug_assertions))]
struct ServerProcess(Mutex<Option<Child>>);

#[cfg(not(debug_assertions))]
fn wait_for_port(port: u16, timeout_secs: u64) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(timeout_secs) {
        if TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("failed to get resource dir");
                let server_dir = resource_dir.join("server");
                let server_js = server_dir.join("server.js");

                if !server_js.exists() {
                    eprintln!(
                        "ERROR: server.js not found at {}",
                        server_js.display()
                    );
                    return Ok(());
                }

                // Use the app's data directory for the writable SQLite database
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .expect("failed to get app data dir");
                std::fs::create_dir_all(&app_data_dir).ok();

                // Copy database from resources to app data dir if it doesn't exist yet
                let db_resource = server_dir.join("dev.db");
                let db_target = app_data_dir.join("linker.db");
                if !db_target.exists() && db_resource.exists() {
                    std::fs::copy(&db_resource, &db_target).ok();
                }

                // Also copy prisma schema to app data dir for runtime
                let prisma_dir = app_data_dir.join("prisma");
                std::fs::create_dir_all(&prisma_dir).ok();
                let schema_src = server_dir.join("prisma").join("schema.prisma");
                let schema_dst = prisma_dir.join("schema.prisma");
                if schema_src.exists() {
                    std::fs::copy(&schema_src, &schema_dst).ok();
                }

                let db_url = format!("file:{}", db_target.display());

                println!(
                    "Starting Next.js server from: {}",
                    server_js.display()
                );
                println!("Database: {}", db_target.display());

                // Use bundled node binary, fall back to system node
                let node_bin = if cfg!(target_os = "windows") {
                    server_dir.join("node.exe")
                } else {
                    server_dir.join("node")
                };

                let node_cmd = if node_bin.exists() {
                    println!("Using bundled Node.js: {}", node_bin.display());
                    node_bin.to_string_lossy().to_string()
                } else {
                    println!("Bundled Node.js not found, falling back to system node");
                    "node".to_string()
                };

                let child = Command::new(&node_cmd)
                    .arg(&server_js)
                    .current_dir(&server_dir)
                    .env("PORT", "4983")
                    .env("HOSTNAME", "127.0.0.1")
                    .env("NODE_ENV", "production")
                    .env("DATABASE_URL", &db_url)
                    .spawn()
                    .expect("failed to start Next.js server");

                app.manage(ServerProcess(Mutex::new(Some(child))));

                println!("Waiting for server on port 4983...");
                if wait_for_port(4983, 30) {
                    println!("Server is ready on port 4983");
                } else {
                    eprintln!("WARNING: Server did not respond on port 4983 within 30 seconds");
                }
            }

            // Suppress unused variable warning in debug mode
            #[cfg(debug_assertions)]
            let _ = app;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                #[cfg(not(debug_assertions))]
                if let Some(state) = window.try_state::<ServerProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            println!("Shutting down Next.js server...");
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }

                #[cfg(debug_assertions)]
                let _ = window;
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
