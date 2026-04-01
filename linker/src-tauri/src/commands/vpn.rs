#[tauri::command]
pub async fn get_vpn_status() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| {
        // Check if WireGuard interface exists via ifconfig (no sudo needed)
        let ifconfig = std::process::Command::new("ifconfig")
            .output();

        let mut is_connected = false;
        let mut local_ip: Option<String> = None;
        let mut interface_name: Option<String> = None;

        if let Ok(output) = ifconfig {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Look for utun interface with 10.10.10.x IP
            for line in stdout.lines() {
                if line.starts_with("utun") && line.contains("flags") {
                    interface_name = Some(line.split(':').next().unwrap_or("utun").to_string());
                }
                if line.contains("10.10.10.") {
                    is_connected = true;
                    if let Some(ip) = line.split_whitespace()
                        .find(|s| s.starts_with("10.10.10."))
                    {
                        local_ip = Some(ip.to_string());
                    }
                }
            }
        }

        // If connected, try ping to get latency
        let mut latency: Option<u128> = None;
        if is_connected {
            let start = std::time::Instant::now();
            let ping = std::process::Command::new("ping")
                .args(["-c", "1", "-W", "2", "10.10.10.1"])
                .output();
            if let Ok(output) = ping {
                if output.status.success() {
                    latency = Some(start.elapsed().as_millis());
                }
            }
        }

        Ok(serde_json::json!({
            "connected": is_connected,
            "localIp": local_ip,
            "interface": interface_name,
            "latency": latency,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn connect_vpn() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| {
        // Find WireGuard config
        let config_paths = [
            std::path::PathBuf::from("../wg-ameca.conf"),
            std::path::PathBuf::from("../../wg-ameca.conf"),
            dirs_next::home_dir().map(|h| h.join("projects/redAmeca/wg-ameca.conf")).unwrap_or_default(),
        ];

        let config_path = config_paths.iter()
            .find(|p| p.exists())
            .ok_or("No se encontro el archivo wg-ameca.conf")?;

        // Try with osascript (macOS sudo prompt)
        let escaped = config_path.to_string_lossy().replace('"', r#"\""#);
        let output = std::process::Command::new("osascript")
            .args(["-e", &format!(
                r#"do shell script "wg-quick up \"{}\"" with administrator privileges"#,
                escaped
            )])
            .output()
            .map_err(|e| format!("Error: {}", e))?;

        if output.status.success() {
            Ok(serde_json::json!({
                "success": true,
                "message": "VPN conectada",
            }))
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("already exists") {
                Ok(serde_json::json!({
                    "success": true,
                    "message": "VPN ya estaba conectada",
                }))
            } else {
                Err(format!("Error: {}", stderr))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn disconnect_vpn() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| {
        let config_paths = [
            std::path::PathBuf::from("../wg-ameca.conf"),
            std::path::PathBuf::from("../../wg-ameca.conf"),
            dirs_next::home_dir().map(|h| h.join("projects/redAmeca/wg-ameca.conf")).unwrap_or_default(),
        ];

        let config_path = config_paths.iter()
            .find(|p| p.exists())
            .ok_or("No se encontro el archivo wg-ameca.conf")?;

        let escaped = config_path.to_string_lossy().replace('"', r#"\""#);
        let output = std::process::Command::new("osascript")
            .args(["-e", &format!(
                r#"do shell script "wg-quick down \"{}\"" with administrator privileges"#,
                escaped
            )])
            .output()
            .map_err(|e| format!("Error: {}", e))?;

        if output.status.success() {
            Ok(serde_json::json!({
                "success": true,
                "message": "VPN desconectada",
            }))
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Error: {}", stderr))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
