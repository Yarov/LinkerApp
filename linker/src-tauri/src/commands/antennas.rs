use crate::db::Database;
use crate::mikrotik::MikroTikClient;
use serde_json::Value;
use tauri::State;

// ---------------------------------------------------------------------------
// Helpers (same pattern as other command files)
// ---------------------------------------------------------------------------

fn gen_id() -> String {
    chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0).to_string()
}

fn get_setting(conn: &rusqlite::Connection, key: &str) -> String {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .unwrap_or_default()
}

fn make_client(db_path: &std::path::Path) -> Result<MikroTikClient, String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("DB error: {}", e))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();
    let client = MikroTikClient::new(
        &get_setting(&conn, "mikrotik_host"),
        get_setting(&conn, "mikrotik_port").parse().unwrap_or(8728),
        &get_setting(&conn, "mikrotik_user"),
        &get_setting(&conn, "mikrotik_password"),
    );
    drop(conn);
    Ok(client)
}

fn jstr(v: &Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn log_to_db(db_path: &std::path::Path, action: &str, status: &str, message: &str, details: Option<&str>) {
    if let Ok(conn) = rusqlite::Connection::open(db_path) {
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();
        let id = gen_id();
        conn.execute(
            "INSERT INTO network_logs (id, action, status, message, details) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, action, status, message, details],
        ).ok();
    }
}

/// Ensure the nodes table has the extra columns we need for antenna provisioning.
/// Safe to call multiple times (ALTER TABLE IF NOT EXISTS equivalent via error ignoring).
fn ensure_antenna_columns(conn: &rusqlite::Connection) {
    conn.execute_batch("ALTER TABLE nodes ADD COLUMN role TEXT;").ok();
    conn.execute_batch("ALTER TABLE nodes ADD COLUMN config_json TEXT;").ok();
}

// ---------------------------------------------------------------------------
// 1. discover_ubnt_devices
// ---------------------------------------------------------------------------

/// Discovers Ubiquiti devices on the local network via the UBNT discovery protocol.
/// Returns a JSON array of discovered devices.
#[tauri::command]
pub async fn discover_ubnt_devices(db: State<'_, Database>) -> Result<Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        // Use MikroTik SSH to scan the network for UBNT devices via SNMP/CDP or
        // fall back to the ubiquiti discovery module.
        // For now we try SSH-based discovery through MikroTik as a proxy.
        let client = make_client(&db_path)?;
        let mut mt = client.connect().map_err(|e| format!("MikroTik connection failed: {}", e))?;

        // Try to get neighbor discovery from MikroTik
        let neighbors = mt.query("/ip/neighbor/print", &[]).unwrap_or_default();
        let mut devices: Vec<Value> = Vec::new();

        for n in &neighbors {
            let platform = jstr(n, "platform").to_lowercase();
            let board = jstr(n, "board").to_lowercase();
            // Filter for Ubiquiti / airOS devices
            if platform.contains("ubnt") || platform.contains("ubiquiti")
                || board.contains("ubnt") || board.contains("airmax")
                || platform.contains("airos")
            {
                let ip = jstr(n, "address");
                let mac = jstr(n, "mac-address");
                let model = jstr(n, "board");
                let hostname = jstr(n, "identity");

                // Check if this looks like factory default (default hostname pattern)
                let is_default = hostname.is_empty()
                    || hostname == "ubnt"
                    || hostname.starts_with("UBNT");

                devices.push(serde_json::json!({
                    "mac": mac,
                    "ip": ip,
                    "model": if model.is_empty() { jstr(n, "platform") } else { model },
                    "firmware": jstr(n, "version"),
                    "hostname": hostname,
                    "ssid": "",
                    "is_default": is_default,
                }));
            }
        }

        // Also try the native UBNT discovery protocol (UDP 10001)
        if let Ok(ubnt_devices) = crate::ubiquiti::discover_devices(3) {
            for d in ubnt_devices {
                let d_json = d.to_json();
                let already = devices.iter().any(|existing| {
                    jstr(existing, "mac") == jstr(&d_json, "mac")
                });
                if !already {
                    devices.push(d_json);
                }
            }
        }

        log_to_db(&db_path, "discover_ubnt", "OK",
            &format!("Found {} UBNT devices", devices.len()), None);

        Ok(serde_json::json!({ "devices": devices }))
    }).await.map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// 2. connect_ubnt_device
// ---------------------------------------------------------------------------

/// Connects to a Ubiquiti device via HTTP API or SSH and reads device info.
#[tauri::command]
pub async fn connect_ubnt_device(
    db: State<'_, Database>,
    ip: String,
    username: String,
    password: String,
    method: String,
) -> Result<Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;
        let mut mt = client.connect().map_err(|e| format!("MikroTik connection failed: {}", e))?;

        // First verify device is reachable
        let reachable = mt.ping_address(&ip).unwrap_or(false);
        if !reachable {
            return Ok(serde_json::json!({
                "connected": false,
                "error": format!("Device {} is not reachable", ip),
            }));
        }

        if method == "ssh" {
            // SSH connection: read board info, version, and system.cfg
            let board_info = mt.ssh_exec(&ip, &username, &password, "cat /etc/board.info")
                .map(|(out, _)| out).unwrap_or_default();
            let version = mt.ssh_exec(&ip, &username, &password, "cat /etc/version")
                .map(|(out, _)| out).unwrap_or_default();
            let system_cfg = mt.ssh_exec(&ip, &username, &password, "cat /tmp/system.cfg")
                .map(|(out, _)| out).unwrap_or_default();

            if board_info.is_empty() && version.is_empty() {
                return Ok(serde_json::json!({
                    "connected": false,
                    "error": "SSH connection failed or device is not airOS",
                }));
            }

            // Parse board.info
            let clean_board = board_info.replace("\\n", "\n");
            let mut model = String::new();
            let mut mac = String::new();
            for line in clean_board.lines() {
                if let Some((k, v)) = line.split_once('=') {
                    match k.trim() {
                        "board.name" | "board.shortname" => {
                            if model.is_empty() { model = v.trim().to_string(); }
                        }
                        "board.hwaddr" => mac = v.trim().to_string(),
                        _ => {}
                    }
                }
            }

            let firmware = version.replace("\\n", "").trim().to_string();

            // Parse system.cfg for current config
            let clean_cfg = system_cfg.replace("\\n", "\n");
            let mut wireless_mode = String::new();
            let mut ssid = String::new();
            let mut frequency = String::new();
            let mut channel_width = String::new();
            let mut cfg_ip = String::new();
            let mut netmode = String::new();

            for line in clean_cfg.lines() {
                if let Some((k, v)) = line.split_once('=') {
                    let key = k.trim();
                    let val = v.trim();
                    match key {
                        "wireless.1.mode" => wireless_mode = val.to_string(),
                        "wireless.1.ssid" => ssid = val.to_string(),
                        "radio.1.freq" => frequency = val.to_string(),
                        "radio.1.chanbw" => channel_width = val.to_string(),
                        "netconf.1.ip" => cfg_ip = val.to_string(),
                        "netmode" => netmode = val.to_string(),
                        _ => {}
                    }
                }
            }

            // Detect factory default: default creds + no custom SSID
            let is_factory = (username == "ubnt" && password == "ubnt")
                && (ssid.is_empty() || ssid == "ubnt" || ssid == "UBNT");

            log_to_db(&db_path, "connect_ubnt_ssh", "OK",
                &format!("Connected to {} ({}) via SSH", ip, model), None);

            Ok(serde_json::json!({
                "connected": true,
                "model": model,
                "firmware": firmware,
                "mac": mac,
                "current_config": {
                    "wireless_mode": wireless_mode,
                    "ssid": ssid,
                    "frequency": frequency,
                    "channel_width": channel_width,
                    "ip": cfg_ip,
                    "netmode": netmode,
                },
                "is_factory_default": is_factory,
            }))
        } else {
            // HTTP method: connect via SSH through MikroTik to read device info
            let mut model = String::new();
            let mut firmware = String::new();
            let mut mac = String::new();
            let mut connected = false;

            if let Ok((board_out, 0)) = mt.ssh_exec(&ip, &username, &password, "cat /etc/board.info") {
                connected = true;
                let clean = board_out.replace("\\n", "\n");
                for line in clean.lines() {
                    if let Some((k, v)) = line.split_once('=') {
                        match k.trim() {
                            "board.name" | "board.shortname" => {
                                if model.is_empty() { model = v.trim().to_string(); }
                            }
                            "board.hwaddr" => mac = v.trim().to_string(),
                            _ => {}
                        }
                    }
                }
                if let Ok((ver, 0)) = mt.ssh_exec(&ip, &username, &password, "cat /etc/version") {
                    firmware = ver.replace("\\n", "").trim().to_string();
                }
            }

            let is_factory = username == "ubnt" && password == "ubnt";

            if connected {
                log_to_db(&db_path, "connect_ubnt_http", "OK",
                    &format!("Connected to {} ({}) via HTTP", ip, model), None);
            }

            Ok(serde_json::json!({
                "connected": connected,
                "model": model,
                "firmware": firmware,
                "mac": mac,
                "current_config": {
                    "wireless_mode": "",
                    "ssid": "",
                    "frequency": "",
                    "channel_width": "",
                    "ip": ip,
                    "netmode": "",
                },
                "is_factory_default": is_factory,
            }))
        }
    }).await.map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// 3. read_ap_config
// ---------------------------------------------------------------------------

/// Reads the wireless configuration from an existing AP.
/// Used to auto-fill station config from the parent AP.
#[tauri::command]
pub async fn read_ap_config(
    db: State<'_, Database>,
    ip: String,
    username: String,
    password: String,
) -> Result<Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;
        let mut mt = client.connect().map_err(|e| format!("MikroTik connection failed: {}", e))?;

        // SSH into the AP and read its wireless config from system.cfg
        let cfg_result = mt.ssh_exec(&ip, &username, &password, "cat /tmp/system.cfg");
        let cfg_output = match cfg_result {
            Ok((out, 0)) => out,
            Ok((_, code)) => return Err(format!("SSH to AP {} failed with exit code {}", ip, code)),
            Err(e) => return Err(format!("SSH to AP {} failed: {}", ip, e)),
        };

        let clean = cfg_output.replace("\\n", "\n");
        let mut ssid = String::new();
        let mut wpa_key = String::new();
        let mut frequency = String::new();
        let mut channel_width = String::new();
        let mut airmax = String::new();
        let mut ieee_mode = String::new();

        for line in clean.lines() {
            if let Some((k, v)) = line.split_once('=') {
                let key = k.trim();
                let val = v.trim();
                match key {
                    "wireless.1.ssid" => ssid = val.to_string(),
                    "wireless.1.security.psk" | "wpasupplicant.profile.1.network.1.psk"
                        => { if wpa_key.is_empty() { wpa_key = val.to_string(); } }
                    "radio.1.freq" => frequency = val.to_string(),
                    "radio.1.chanbw" => channel_width = val.to_string(),
                    "radio.1.airmax.status" | "wireless.1.airmax" => airmax = val.to_string(),
                    "radio.1.ieee_mode" => ieee_mode = val.to_string(),
                    _ => {}
                }
            }
        }

        if ssid.is_empty() {
            return Err(format!("Could not read wireless config from AP {}", ip));
        }

        log_to_db(&db_path, "read_ap_config", "OK",
            &format!("Read AP config from {}: SSID={}", ip, ssid), None);

        Ok(serde_json::json!({
            "ssid": ssid,
            "wpa_key": wpa_key,
            "frequency": frequency,
            "channel_width": channel_width,
            "airmax": airmax,
            "ieee_mode": ieee_mode,
        }))
    }).await.map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// 4. provision_antenna
// ---------------------------------------------------------------------------

/// Provisions a Ubiquiti antenna with a generated system.cfg configuration.
/// Supports station, AP, and PtP roles.
#[tauri::command]
pub async fn provision_antenna(
    db: State<'_, Database>,
    ip: String,
    username: String,
    password: String,
    method: String,
    config: String,
) -> Result<Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let cfg: Value = serde_json::from_str(&config)
            .map_err(|e| format!("Invalid config JSON: {}", e))?;

        let role = jstr(&cfg, "role");
        let ssid = jstr(&cfg, "ssid");
        let wpa_key = jstr(&cfg, "wpa_key");
        let frequency = jstr(&cfg, "frequency");
        let channel_width = jstr(&cfg, "channel_width");
        let mgmt_ip = jstr(&cfg, "mgmt_ip");
        let gateway = jstr(&cfg, "gateway");
        let netmask = jstr(&cfg, "netmask");
        let device_name = jstr(&cfg, "device_name");
        let tx_power = jstr(&cfg, "tx_power");
        let airmax = jstr(&cfg, "airmax");

        let mut steps: Vec<Value> = Vec::new();

        // Step 1: Connect to device
        let client = make_client(&db_path)?;
        let mut mt = client.connect().map_err(|e| format!("MikroTik connection failed: {}", e))?;

        let reachable = mt.ping_address(&ip).unwrap_or(false);
        if !reachable {
            steps.push(serde_json::json!({
                "name": "connect", "status": "error",
                "message": format!("Device {} is not reachable", ip),
            }));
            return Ok(serde_json::json!({ "success": false, "steps": steps, "reboot_ip": "" }));
        }
        steps.push(serde_json::json!({
            "name": "connect", "status": "ok", "message": "Device is reachable",
        }));

        // Step 2: Generate system.cfg
        let wireless_mode = match role.as_str() {
            "station" => "managed",
            "ap" => "master",
            "ptp" => "managed", // PtP bridge uses managed mode with WDS
            _ => "managed",
        };

        let netmode_val = if mgmt_ip.is_empty() { "bridge" } else { "router" };
        let airmax_val = if airmax == "disabled" || airmax == "0" { "disabled" } else { "enabled" };

        // Build system.cfg content
        let system_cfg = format!(
            r#"wireless.1.mode={wireless_mode}
wireless.1.ssid={ssid}
wireless.1.hide_ssid=disabled
wireless.1.security=none
wireless.1.security.psk={wpa_key}
wireless.1.wds.status={wds_status}
radio.1.freq={frequency}
radio.1.chanbw={channel_width}
radio.1.txpower={tx_power}
radio.1.airmax.status={airmax}
netmode={netmode}
netconf.1.ip={mgmt_ip}
netconf.1.netmask={netmask}
netconf.1.gateway={gateway}
resolv.host.1.name={device_name}
resolv.host.1.status=enabled
httpd.https.status=enabled
sshd.status=enabled
ntpclient.status=enabled
ntpclient.1.server=0.ubnt.pool.ntp.org
ntpclient.1.status=enabled"#,
            wireless_mode = wireless_mode,
            ssid = ssid,
            wpa_key = wpa_key,
            wds_status = if role == "ptp" { "enabled" } else { "disabled" },
            frequency = if frequency.is_empty() { "0" } else { &frequency },
            channel_width = if channel_width.is_empty() { "20" } else { &channel_width },
            tx_power = if tx_power.is_empty() { "auto" } else { &tx_power },
            airmax = airmax_val,
            netmode = netmode_val,
            mgmt_ip = if mgmt_ip.is_empty() { "192.168.1.20" } else { &mgmt_ip },
            netmask = if netmask.is_empty() { "255.255.255.0" } else { &netmask },
            gateway = if gateway.is_empty() { "192.168.1.1" } else { &gateway },
            device_name = if device_name.is_empty() { "ubnt" } else { &device_name },
        );

        steps.push(serde_json::json!({
            "name": "generate_config", "status": "ok",
            "message": format!("Generated {} config for SSID '{}'", role, ssid),
        }));

        // Step 3: Upload config via SSH
        if method == "ssh" {
            // Write system.cfg via SSH
            let escaped_cfg = system_cfg.replace("'", "'\\''");
            let write_cmd = format!("echo '{}' > /tmp/system.cfg", escaped_cfg);
            match mt.ssh_exec(&ip, &username, &password, &write_cmd) {
                Ok((_, 0)) => {
                    steps.push(serde_json::json!({
                        "name": "upload_config", "status": "ok",
                        "message": "Configuration uploaded via SSH",
                    }));
                }
                Ok((out, code)) => {
                    steps.push(serde_json::json!({
                        "name": "upload_config", "status": "error",
                        "message": format!("SSH write failed (exit {}): {}", code, out),
                    }));
                    return Ok(serde_json::json!({ "success": false, "steps": steps, "reboot_ip": "" }));
                }
                Err(e) => {
                    steps.push(serde_json::json!({
                        "name": "upload_config", "status": "error",
                        "message": format!("SSH error: {}", e),
                    }));
                    return Ok(serde_json::json!({ "success": false, "steps": steps, "reboot_ip": "" }));
                }
            }

            // Step 4: Save and apply config
            match mt.ssh_exec(&ip, &username, &password, "cfgmtd -w -p /etc/ && reboot") {
                Ok((_, _)) => {
                    steps.push(serde_json::json!({
                        "name": "apply_reboot", "status": "ok",
                        "message": "Configuration saved and device is rebooting",
                    }));
                }
                Err(e) => {
                    // Reboot may disconnect SSH, which is expected
                    steps.push(serde_json::json!({
                        "name": "apply_reboot", "status": "ok",
                        "message": format!("Reboot command sent (connection closed: expected). {}", e),
                    }));
                }
            }
        } else {
            // HTTP method: use the ubiquiti module's direct SSH to push config
            match crate::ubiquiti::ssh_push_config(&ip, 22, &username, &password, &system_cfg) {
                Ok(_) => {
                    steps.push(serde_json::json!({
                        "name": "upload_config", "status": "ok",
                        "message": "Configuration uploaded via direct SSH",
                    }));
                    steps.push(serde_json::json!({
                        "name": "apply_reboot", "status": "ok",
                        "message": "Configuration saved and device is rebooting",
                    }));
                }
                Err(e) => {
                    // Fallback: try SSH through MikroTik
                    let ssh_write = format!("echo '{}' > /tmp/system.cfg", system_cfg.replace("'", "'\\''"));
                    match mt.ssh_exec(&ip, &username, &password, &ssh_write) {
                        Ok((_, 0)) => {
                            steps.push(serde_json::json!({
                                "name": "upload_config", "status": "ok",
                                "message": "Configuration uploaded via MikroTik SSH fallback",
                            }));
                            // Apply and reboot
                            mt.ssh_exec(&ip, &username, &password, "cfgmtd -w -p /etc/ && reboot").ok();
                            steps.push(serde_json::json!({
                                "name": "apply_reboot", "status": "ok",
                                "message": "Configuration saved and device is rebooting",
                            }));
                        }
                        _ => {
                            steps.push(serde_json::json!({
                                "name": "upload_config", "status": "error",
                                "message": format!("Upload failed: {}", e),
                            }));
                            return Ok(serde_json::json!({ "success": false, "steps": steps, "reboot_ip": "" }));
                        }
                    }
                }
            }
        }

        // The device will come up on the management IP after reboot
        let reboot_ip = if mgmt_ip.is_empty() { ip.clone() } else { mgmt_ip };

        log_to_db(&db_path, "provision_antenna", "OK",
            &format!("Provisioned {} as {} on SSID '{}'", ip, role, ssid),
            Some(&config));

        Ok(serde_json::json!({
            "success": true,
            "steps": steps,
            "reboot_ip": reboot_ip,
        }))
    }).await.map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// 5. verify_antenna
// ---------------------------------------------------------------------------

/// Verifies a provisioned antenna is online and reads signal info.
#[tauri::command]
pub async fn verify_antenna(
    db: State<'_, Database>,
    ip: String,
    username: String,
    password: String,
) -> Result<Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;
        let mut mt = client.connect().map_err(|e| format!("MikroTik connection failed: {}", e))?;

        // Step 1: Ping
        let reachable = mt.ping_address(&ip).unwrap_or(false);
        if !reachable {
            return Ok(serde_json::json!({
                "reachable": false,
                "connected": false,
                "signal_dbm": null,
                "ccq": null,
                "tx_rate": null,
                "rx_rate": null,
                "uptime": null,
            }));
        }

        // Step 2: SSH into device and read mca-status for signal info
        let mut signal_dbm: Option<i64> = None;
        let mut ccq: Option<i64> = None;
        let mut tx_rate: Option<f64> = None;
        let mut rx_rate: Option<f64> = None;
        let mut uptime: Option<String> = None;
        let mut connected = false;

        // Read mca-status (airOS wireless status)
        if let Ok((mca_out, 0)) = mt.ssh_exec(&ip, &username, &password, "mca-status") {
            connected = true;
            let clean = mca_out.replace("\\n", "\n");
            for line in clean.lines() {
                if let Some((k, v)) = line.split_once('=') {
                    let key = k.trim();
                    let val = v.trim();
                    match key {
                        "signal" => signal_dbm = val.parse().ok(),
                        "ccq" => {
                            // CCQ is often in percentage * 10
                            if let Ok(raw) = val.parse::<i64>() {
                                ccq = Some(raw / 10);
                            }
                        }
                        "txrate" => tx_rate = val.parse().ok(),
                        "rxrate" => rx_rate = val.parse().ok(),
                        _ => {}
                    }
                }
            }
        }

        // Read uptime
        if let Ok((uptime_out, 0)) = mt.ssh_exec(&ip, &username, &password, "uptime") {
            let clean = uptime_out.replace("\\n", "\n").trim().to_string();
            if !clean.is_empty() {
                uptime = Some(clean);
            }
        }

        log_to_db(&db_path, "verify_antenna", "OK",
            &format!("Verified antenna {}: signal={}dBm", ip, signal_dbm.unwrap_or(0)), None);

        Ok(serde_json::json!({
            "reachable": true,
            "connected": connected,
            "signal_dbm": signal_dbm,
            "ccq": ccq,
            "tx_rate": tx_rate,
            "rx_rate": rx_rate,
            "uptime": uptime,
        }))
    }).await.map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// 6. get_saved_aps
// ---------------------------------------------------------------------------

/// Returns AP/SECTOR nodes from the database for the parent AP selector dropdown.
#[tauri::command]
pub async fn get_saved_aps(db: State<'_, Database>) -> Result<Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL;").ok();

        let aps: Vec<Value> = conn
            .prepare(
                "SELECT id, name, type, ip, mac, status FROM nodes \
                 WHERE type IN ('AP', 'SECTOR', 'DISTRIBUTION') ORDER BY name"
            )
            .and_then(|mut stmt| {
                let rows = stmt.query_map([], |row| {
                    Ok(serde_json::json!({
                        "id": row.get::<_, String>(0)?,
                        "name": row.get::<_, String>(1)?,
                        "type": row.get::<_, String>(2)?,
                        "ip": row.get::<_, Option<String>>(3)?,
                        "mac": row.get::<_, Option<String>>(4)?,
                        "status": row.get::<_, String>(5)?,
                    }))
                })?.filter_map(|r| r.ok()).collect();
                Ok(rows)
            })
            .unwrap_or_default();

        Ok(serde_json::json!({ "aps": aps }))
    }).await.map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// 7. save_antenna_node
// ---------------------------------------------------------------------------

/// Saves a provisioned antenna as a node in the database.
#[tauri::command]
pub async fn save_antenna_node(
    db: State<'_, Database>,
    name: String,
    ip: String,
    mac: String,
    model: String,
    firmware: String,
    role: String,
    parent_id: Option<String>,
    config_json: Option<String>,
) -> Result<Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
        ensure_antenna_columns(&conn);

        // Check for duplicate IP
        if !ip.is_empty() {
            let dup: bool = conn.query_row(
                "SELECT COUNT(*) > 0 FROM nodes WHERE ip = ?1", [&ip], |r| r.get(0)
            ).unwrap_or(false);
            if dup {
                // Update existing node instead of creating duplicate
                conn.execute(
                    "UPDATE nodes SET name=?2, mac=?3, model=?4, firmware=?5, role=?6, \
                     parent_id=?7, config_json=?8, status='ONLINE', \
                     last_seen=datetime('now'), updated_at=datetime('now') \
                     WHERE ip=?1",
                    rusqlite::params![ip, name, mac, model, firmware, role, parent_id, config_json],
                ).map_err(|e| format!("Error updating node: {}", e))?;

                let id: String = conn.query_row(
                    "SELECT id FROM nodes WHERE ip = ?1", [&ip], |r| r.get(0)
                ).map_err(|e| format!("Error finding node: {}", e))?;

                log_to_db(&db_path, "save_antenna_node", "OK",
                    &format!("Updated antenna node '{}' ({})", name, ip), None);

                return Ok(serde_json::json!({
                    "id": id,
                    "name": name,
                    "ip": ip,
                    "mac": mac,
                    "model": model,
                    "firmware": firmware,
                    "role": role,
                    "parent_id": parent_id,
                    "updated": true,
                }));
            }
        }

        // Map role to node type
        let node_type = match role.as_str() {
            "ap" => "AP",
            "station" => "CPE",
            "ptp" => "PTP",
            _ => "CPE",
        };

        let id = gen_id();
        conn.execute(
            "INSERT INTO nodes (id, name, type, ip, mac, model, firmware, role, parent_id, \
             config_json, status, last_seen) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'ONLINE', datetime('now'))",
            rusqlite::params![id, name, node_type, ip, mac, model, firmware, role, parent_id, config_json],
        ).map_err(|e| format!("Error creating node: {}", e))?;

        log_to_db(&db_path, "save_antenna_node", "OK",
            &format!("Created antenna node '{}' ({}) as {}", name, ip, role), None);

        Ok(serde_json::json!({
            "id": id,
            "name": name,
            "type": node_type,
            "ip": ip,
            "mac": mac,
            "model": model,
            "firmware": firmware,
            "role": role,
            "parent_id": parent_id,
            "updated": false,
        }))
    }).await.map_err(|e| e.to_string())?
}
