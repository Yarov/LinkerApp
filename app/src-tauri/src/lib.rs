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
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .expect("failed to get app data dir");
                std::fs::create_dir_all(&app_data_dir).ok();

                let server_dir = app_data_dir.join("server");
                let server_js = server_dir.join("server.js");

                // First launch: extract server.tar.gz
                if !server_js.exists() {
                    let tar_path = resource_dir.join("server.tar.gz");
                    if tar_path.exists() {
                        println!("First launch: extracting server from {:?}...", tar_path);

                        let extract_cmd = if cfg!(target_os = "windows") {
                            // Windows: use tar (available since Windows 10)
                            format!(
                                "tar -xzf \"{}\" -C \"{}\"",
                                tar_path.display(),
                                app_data_dir.display()
                            )
                        } else {
                            format!(
                                "tar -xzf '{}' -C '{}'",
                                tar_path.display(),
                                app_data_dir.display()
                            )
                        };

                        let status = if cfg!(target_os = "windows") {
                            Command::new("cmd")
                                .args(["/C", &extract_cmd])
                                .status()
                        } else {
                            Command::new("sh")
                                .args(["-c", &extract_cmd])
                                .status()
                        };

                        match status {
                            Ok(s) if s.success() => {
                                println!("Server extracted to {:?}", server_dir);
                                // Make node binary executable on Unix
                                #[cfg(not(target_os = "windows"))]
                                {
                                    let node_bin = server_dir.join("node");
                                    if node_bin.exists() {
                                        Command::new("chmod")
                                            .args(["+x", &node_bin.to_string_lossy().to_string()])
                                            .status()
                                            .ok();
                                    }
                                }
                            }
                            Ok(s) => eprintln!("tar extraction failed with code: {}", s),
                            Err(e) => eprintln!("Failed to run tar: {}", e),
                        }
                    } else {
                        eprintln!("ERROR: server.tar.gz not found at {:?}", tar_path);
                        return Ok(());
                    }
                }

                if !server_js.exists() {
                    eprintln!("ERROR: server.js not found after extraction at {:?}", server_js);
                    return Ok(());
                }

                // Database setup
                let db_resource = server_dir.join("dev.db");
                let db_target = app_data_dir.join("linker.db");
                if !db_target.exists() && db_resource.exists() {
                    std::fs::copy(&db_resource, &db_target).ok();
                    println!("Initial database copied to {:?}", db_target);
                }

                let db_url = format!("file:{}", db_target.display());

                // Use bundled node or system node
                let node_bin = if cfg!(target_os = "windows") {
                    server_dir.join("node.exe")
                } else {
                    server_dir.join("node")
                };

                let node_cmd = if node_bin.exists() {
                    println!("Using bundled Node.js: {:?}", node_bin);
                    node_bin.to_string_lossy().to_string()
                } else {
                    println!("Using system Node.js");
                    "node".to_string()
                };

                println!("Starting server: {} {:?}", node_cmd, server_js);

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
                    println!("Server ready!");
                } else {
                    eprintln!("WARNING: Server did not start within 30 seconds");
                }
            }

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
                            println!("Shutting down server...");
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
