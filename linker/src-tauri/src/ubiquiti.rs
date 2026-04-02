use std::collections::HashMap;
use std::net::UdpSocket;
use std::time::Duration;
use serde_json::Value;

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

pub struct UbntDevice {
    pub mac: String,
    pub ip: String,
    pub model: String,
    pub firmware: String,
    pub hostname: String,
    pub ssid: String,
    pub is_default: bool,
}

pub struct UbntConfig {
    pub entries: HashMap<String, String>,
}

pub struct UbntConnection {
    client: reqwest::Client,
    base_url: String,
    cookie: Option<String>,
}

// ---------------------------------------------------------------------------
// 1. UBNT Discovery Protocol (UDP 10001)
// ---------------------------------------------------------------------------

/// Send UBNT discovery probe and collect responses
pub fn discover_devices(timeout_secs: u64) -> Result<Vec<UbntDevice>, String> {
    println!("[UBNT] Starting discovery on UDP 10001...");

    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Bind UDP socket: {}", e))?;
    socket.set_broadcast(true)
        .map_err(|e| format!("Set SO_BROADCAST: {}", e))?;
    socket.set_read_timeout(Some(Duration::from_secs(timeout_secs)))
        .map_err(|e| format!("Set read timeout: {}", e))?;

    // Discovery probe: 4 bytes
    let probe: [u8; 4] = [0x01, 0x00, 0x00, 0x00];
    socket.send_to(&probe, "255.255.255.255:10001")
        .map_err(|e| format!("Send discovery probe: {}", e))?;

    println!("[UBNT] Probe sent, waiting for responses ({} sec timeout)...", timeout_secs);

    let mut devices = Vec::new();
    let mut buf = [0u8; 4096];

    loop {
        match socket.recv_from(&mut buf) {
            Ok((len, addr)) => {
                println!("[UBNT] Response from {} ({} bytes)", addr, len);
                if len < 4 {
                    continue;
                }
                match parse_discovery_response(&buf[..len]) {
                    Ok(device) => {
                        println!("[UBNT] Found: {} ({}) at {} fw={}", device.hostname, device.model, device.ip, device.firmware);
                        devices.push(device);
                    }
                    Err(e) => {
                        println!("[UBNT] Parse error from {}: {}", addr, e);
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                       || e.kind() == std::io::ErrorKind::TimedOut => {
                break;
            }
            Err(e) => {
                println!("[UBNT] Recv error: {}", e);
                break;
            }
        }
    }

    println!("[UBNT] Discovery complete, found {} device(s)", devices.len());
    Ok(devices)
}

/// Parse a TLV-encoded discovery response into UbntDevice
fn parse_discovery_response(data: &[u8]) -> Result<UbntDevice, String> {
    // First 4 bytes are header (version + data length), TLVs start at offset 4
    if data.len() < 4 {
        return Err("Response too short".to_string());
    }

    let mut mac = String::new();
    let mut ip = String::new();
    let mut model = String::new();
    let mut firmware = String::new();
    let mut hostname = String::new();
    let mut ssid = String::new();

    let mut offset = 4; // skip header

    while offset + 3 <= data.len() {
        let tlv_type = data[offset];
        let tlv_len = u16::from_be_bytes([data[offset + 1], data[offset + 2]]) as usize;
        offset += 3;

        if offset + tlv_len > data.len() {
            println!("[UBNT] TLV truncated: type=0x{:02X} len={} remaining={}", tlv_type, tlv_len, data.len() - offset);
            break;
        }

        let value = &data[offset..offset + tlv_len];

        match tlv_type {
            0x01 => {
                // Hardware address (MAC) — 6 bytes
                if value.len() >= 6 {
                    mac = format!("{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
                        value[0], value[1], value[2], value[3], value[4], value[5]);
                }
            }
            0x02 => {
                // IP + MAC info — 10 bytes: 6 MAC + 4 IP
                if value.len() >= 10 {
                    if mac.is_empty() {
                        mac = format!("{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
                            value[0], value[1], value[2], value[3], value[4], value[5]);
                    }
                    ip = format!("{}.{}.{}.{}", value[6], value[7], value[8], value[9]);
                }
            }
            0x03 => {
                // Firmware version
                firmware = String::from_utf8_lossy(value).trim_end_matches('\0').to_string();
            }
            0x0B => {
                // Hostname
                hostname = String::from_utf8_lossy(value).trim_end_matches('\0').to_string();
            }
            0x0C => {
                // Model short name
                model = String::from_utf8_lossy(value).trim_end_matches('\0').to_string();
            }
            0x0D => {
                // SSID
                ssid = String::from_utf8_lossy(value).trim_end_matches('\0').to_string();
            }
            _ => {
                // Skip unknown TLV types
            }
        }

        offset += tlv_len;
    }

    // Factory default detection: hostname is "UBNT" or empty, or default SSID
    let is_default = hostname.is_empty()
        || hostname == "UBNT"
        || hostname == "ubnt"
        || (ssid.is_empty() && hostname.starts_with("UBNT"));

    Ok(UbntDevice {
        mac,
        ip,
        model,
        firmware,
        hostname,
        ssid,
        is_default,
    })
}

// ---------------------------------------------------------------------------
// 2. airOS HTTP API Client
// ---------------------------------------------------------------------------

impl UbntConnection {
    /// Create a new connection (does not authenticate yet)
    pub fn new(ip: &str) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .cookie_store(true)
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| format!("Build HTTP client: {}", e))?;

        let base_url = format!("https://{}", ip);
        println!("[UBNT] HTTP client created for {}", base_url);

        Ok(Self {
            client,
            base_url,
            cookie: None,
        })
    }

    /// Authenticate to airOS — POST /api/auth with JSON credentials
    pub async fn login(&mut self, username: &str, password: &str) -> Result<(), String> {
        let url = format!("{}/api/auth", self.base_url);
        println!("[UBNT] Login to {} as '{}'...", url, username);

        let body = serde_json::json!({
            "username": username,
            "password": password,
        });

        let resp = self.client.post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Login request failed: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Login failed (HTTP {}): {}", status, text));
        }

        // Extract session cookie from response headers
        if let Some(cookie_header) = resp.headers().get("set-cookie") {
            let cookie_str = cookie_header.to_str().unwrap_or("").to_string();
            println!("[UBNT] Got session cookie");
            self.cookie = Some(cookie_str);
        }

        println!("[UBNT] Login successful");
        Ok(())
    }

    /// GET /api/v1/config — full device configuration as JSON
    pub async fn get_config(&self) -> Result<Value, String> {
        let url = format!("{}/api/v1/config", self.base_url);
        println!("[UBNT] GET {}", url);

        let resp = self.client.get(&url)
            .send()
            .await
            .map_err(|e| format!("Get config failed: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Get config failed (HTTP {}): {}", status, text));
        }

        let json: Value = resp.json().await
            .map_err(|e| format!("Parse config JSON: {}", e))?;

        println!("[UBNT] Config retrieved successfully");
        Ok(json)
    }

    /// POST /api/v1/config — set partial configuration
    pub async fn set_config(&self, config: &Value) -> Result<Value, String> {
        let url = format!("{}/api/v1/config", self.base_url);
        println!("[UBNT] POST {} (set config)", url);

        let resp = self.client.post(&url)
            .json(config)
            .send()
            .await
            .map_err(|e| format!("Set config failed: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Set config failed (HTTP {}): {}", status, text));
        }

        let json: Value = resp.json().await.unwrap_or(Value::Null);
        println!("[UBNT] Config set successfully");
        Ok(json)
    }

    /// POST /api/v1/config/apply — save and reboot
    pub async fn apply_config(&self) -> Result<(), String> {
        let url = format!("{}/api/v1/config/apply", self.base_url);
        println!("[UBNT] POST {} (apply/reboot)", url);

        let resp = self.client.post(&url)
            .send()
            .await
            .map_err(|e| format!("Apply config failed: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Apply config failed (HTTP {}): {}", status, text));
        }

        println!("[UBNT] Config applied, device rebooting");
        Ok(())
    }

    /// GET /status.cgi — device status
    pub async fn get_status(&self) -> Result<Value, String> {
        let url = format!("{}/status.cgi", self.base_url);
        println!("[UBNT] GET {}", url);

        let resp = self.client.get(&url)
            .send()
            .await
            .map_err(|e| format!("Get status failed: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Get status failed (HTTP {}): {}", status, text));
        }

        let json: Value = resp.json().await
            .map_err(|e| format!("Parse status JSON: {}", e))?;

        println!("[UBNT] Status retrieved successfully");
        Ok(json)
    }
}

// ---------------------------------------------------------------------------
// UbntConfig — system.cfg parser
// ---------------------------------------------------------------------------

impl UbntConfig {
    /// Parse system.cfg content (key=value lines) into UbntConfig
    pub fn parse(content: &str) -> Self {
        let mut entries = HashMap::new();
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some(pos) = line.find('=') {
                let key = line[..pos].to_string();
                let value = line[pos + 1..].to_string();
                entries.insert(key, value);
            }
        }
        println!("[UBNT] Parsed system.cfg: {} entries", entries.len());
        Self { entries }
    }

    /// Serialize back to system.cfg format
    pub fn to_string(&self) -> String {
        let mut lines: Vec<String> = self.entries.iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect();
        lines.sort();
        lines.join("\n") + "\n"
    }

    /// Get a value by key
    pub fn get(&self, key: &str) -> Option<&str> {
        self.entries.get(key).map(|s| s.as_str())
    }

    /// Set a value
    pub fn set(&mut self, key: &str, value: &str) {
        self.entries.insert(key.to_string(), value.to_string());
    }
}

// ---------------------------------------------------------------------------
// 3. SSH Config Push
// ---------------------------------------------------------------------------

/// Push system.cfg content to a Ubiquiti device via SSH and apply it
pub fn ssh_push_config(
    ip: &str,
    port: u16,
    username: &str,
    password: &str,
    config_content: &str,
) -> Result<String, String> {
    println!("[UBNT] SSH connecting to {}:{} as '{}'...", ip, port, username);

    let tcp = std::net::TcpStream::connect_timeout(
        &format!("{}:{}", ip, port).parse()
            .map_err(|e| format!("Invalid address: {}", e))?,
        Duration::from_secs(10),
    ).map_err(|e| format!("SSH TCP connect to {}:{} failed: {}", ip, port, e))?;

    let mut session = ssh2::Session::new()
        .map_err(|e| format!("Create SSH session: {}", e))?;
    session.set_tcp_stream(tcp);
    session.handshake()
        .map_err(|e| format!("SSH handshake: {}", e))?;
    session.userauth_password(username, password)
        .map_err(|e| format!("SSH auth failed: {}", e))?;

    if !session.authenticated() {
        return Err("SSH authentication failed".to_string());
    }

    println!("[UBNT] SSH authenticated, uploading config...");

    // Upload system.cfg to /tmp/system.cfg via SCP
    let config_bytes = config_content.as_bytes();
    let mut remote_file = session.scp_send(
        std::path::Path::new("/tmp/system.cfg"),
        0o644,
        config_bytes.len() as u64,
        None,
    ).map_err(|e| format!("SCP send: {}", e))?;

    use std::io::Write;
    remote_file.write_all(config_bytes)
        .map_err(|e| format!("SCP write: {}", e))?;
    // Send EOF and close the SCP channel
    remote_file.send_eof()
        .map_err(|e| format!("SCP send_eof: {}", e))?;
    remote_file.wait_eof()
        .map_err(|e| format!("SCP wait_eof: {}", e))?;
    remote_file.close()
        .map_err(|e| format!("SCP close: {}", e))?;
    remote_file.wait_close()
        .map_err(|e| format!("SCP wait_close: {}", e))?;

    println!("[UBNT] Config uploaded, applying with cfgmtd...");

    // Copy to /etc/ and apply
    let command = "cp /tmp/system.cfg /tmp/system.cfg.bak && cfgmtd -w -p /etc/ && reboot";
    let mut channel = session.channel_session()
        .map_err(|e| format!("Open SSH channel: {}", e))?;
    channel.exec(command)
        .map_err(|e| format!("SSH exec: {}", e))?;

    let mut output = String::new();
    use std::io::Read;
    channel.read_to_string(&mut output)
        .map_err(|e| format!("Read SSH output: {}", e))?;
    channel.wait_close()
        .map_err(|e| format!("SSH wait_close: {}", e))?;

    let exit_status = channel.exit_status()
        .map_err(|e| format!("SSH exit status: {}", e))?;

    println!("[UBNT] SSH command exit={}, output: {}", exit_status, output.trim());

    if exit_status != 0 && !output.is_empty() {
        return Err(format!("cfgmtd failed (exit {}): {}", exit_status, output));
    }

    println!("[UBNT] Config applied, device rebooting");
    Ok(output)
}

/// Push config using default UBNT credentials (ubnt/ubnt on port 22)
pub fn ssh_push_config_default(ip: &str, config_content: &str) -> Result<String, String> {
    ssh_push_config(ip, 22, "ubnt", "ubnt", config_content)
}

/// Execute a single command via SSH on a Ubiquiti device
pub fn ssh_exec(
    ip: &str,
    port: u16,
    username: &str,
    password: &str,
    command: &str,
) -> Result<(String, i32), String> {
    println!("[UBNT] SSH exec on {}:{} command: {}", ip, port, command);

    let tcp = std::net::TcpStream::connect_timeout(
        &format!("{}:{}", ip, port).parse()
            .map_err(|e| format!("Invalid address: {}", e))?,
        Duration::from_secs(10),
    ).map_err(|e| format!("SSH TCP connect failed: {}", e))?;

    let mut session = ssh2::Session::new()
        .map_err(|e| format!("Create SSH session: {}", e))?;
    session.set_tcp_stream(tcp);
    session.handshake()
        .map_err(|e| format!("SSH handshake: {}", e))?;
    session.userauth_password(username, password)
        .map_err(|e| format!("SSH auth failed: {}", e))?;

    if !session.authenticated() {
        return Err("SSH authentication failed".to_string());
    }

    let mut channel = session.channel_session()
        .map_err(|e| format!("Open SSH channel: {}", e))?;
    channel.exec(command)
        .map_err(|e| format!("SSH exec: {}", e))?;

    let mut output = String::new();
    use std::io::Read;
    channel.read_to_string(&mut output)
        .map_err(|e| format!("Read SSH output: {}", e))?;
    channel.wait_close()
        .map_err(|e| format!("SSH wait_close: {}", e))?;

    let exit_status = channel.exit_status()
        .map_err(|e| format!("SSH exit status: {}", e))?;

    println!("[UBNT] SSH exit={}, output length={}", exit_status, output.len());
    Ok((output, exit_status))
}

// ---------------------------------------------------------------------------
// 4. Config Template Generator
// ---------------------------------------------------------------------------

/// Generate a system.cfg for a station (client CPE) device
pub fn generate_station_config(
    ssid: &str,
    wpa_key: &str,
    frequency: u32,
    channel_width: u32,
    mgmt_ip: &str,
    gateway: &str,
    device_name: &str,
) -> String {
    println!("[UBNT] Generating station config: ssid={} freq={} width={} ip={}", ssid, frequency, channel_width, mgmt_ip);

    // Parse IP and netmask from CIDR notation (e.g., "192.168.1.10/24")
    let (ip_addr, netmask) = parse_cidr(mgmt_ip);

    let mut lines = Vec::new();

    // Radio settings
    lines.push("radio.1.status=enabled".to_string());
    lines.push("radio.1.mode=managed".to_string());
    lines.push(format!("radio.1.freq={}", frequency));
    lines.push(format!("radio.1.chanbw={}", channel_width));
    lines.push("radio.1.antenna.gain=0".to_string());
    lines.push("radio.1.txpower=auto".to_string());
    lines.push("radio.1.ieee_mode=auto".to_string());
    lines.push("radio.1.countrycode=484".to_string()); // Mexico

    // Wireless settings (station mode)
    lines.push("wireless.1.status=enabled".to_string());
    lines.push("wireless.1.mode=sta".to_string());
    lines.push(format!("wireless.1.ssid={}", ssid));
    lines.push("wireless.1.hide_ssid=disabled".to_string());
    lines.push("wireless.1.security=wpa2".to_string());
    lines.push("wireless.1.wpa.mode=2".to_string());
    lines.push("wireless.1.wpa.psk=0".to_string());
    lines.push(format!("wireless.1.wpa.key={}", wpa_key));
    lines.push("wireless.1.addmtikie=enabled".to_string());

    // Network settings (bridge mode)
    lines.push("bridge.1.status=enabled".to_string());
    lines.push("bridge.1.port.1.devname=eth0".to_string());
    lines.push("bridge.1.port.2.devname=ath0".to_string());
    lines.push("bridge.1.stp.status=disabled".to_string());

    // Management IP
    lines.push("netconf.1.status=enabled".to_string());
    lines.push("netconf.1.autoip=disabled".to_string());
    lines.push(format!("netconf.1.ip={}", ip_addr));
    lines.push(format!("netconf.1.netmask={}", netmask));
    lines.push(format!("netconf.1.gateway={}", gateway));
    lines.push("netconf.1.up=enabled".to_string());

    // DNS
    lines.push("resolv.host.1.status=enabled".to_string());
    lines.push("resolv.nameserver.1.status=enabled".to_string());
    lines.push("resolv.nameserver.1.ip=8.8.8.8".to_string());
    lines.push("resolv.nameserver.2.status=enabled".to_string());
    lines.push("resolv.nameserver.2.ip=8.8.4.4".to_string());

    // System
    lines.push(format!("resolv.host.1.name={}", device_name));
    lines.push(format!("httpd.https.status=enabled"));
    lines.push("httpd.port=443".to_string());
    lines.push("sshd.status=enabled".to_string());
    lines.push("sshd.port=22".to_string());
    lines.push("ntpclient.status=enabled".to_string());
    lines.push("ntpclient.1.server=0.ubnt.pool.ntp.org".to_string());

    // Discovery
    lines.push("discovery.status=enabled".to_string());

    let config = lines.join("\n") + "\n";
    println!("[UBNT] Station config generated: {} lines", lines.len());
    config
}

/// Generate a system.cfg for an AP (access point) device
pub fn generate_ap_config(
    ssid: &str,
    wpa_key: &str,
    frequency: u32,
    channel_width: u32,
    mgmt_ip: &str,
    gateway: &str,
    device_name: &str,
    airmax: bool,
) -> String {
    println!("[UBNT] Generating AP config: ssid={} freq={} width={} ip={} airmax={}", ssid, frequency, channel_width, mgmt_ip, airmax);

    let (ip_addr, netmask) = parse_cidr(mgmt_ip);

    let mut lines = Vec::new();

    // Radio settings
    lines.push("radio.1.status=enabled".to_string());
    lines.push("radio.1.mode=master".to_string());
    lines.push(format!("radio.1.freq={}", frequency));
    lines.push(format!("radio.1.chanbw={}", channel_width));
    lines.push("radio.1.antenna.gain=0".to_string());
    lines.push("radio.1.txpower=auto".to_string());
    lines.push("radio.1.ieee_mode=auto".to_string());
    lines.push("radio.1.countrycode=484".to_string());
    lines.push("radio.1.ack.auto=enabled".to_string());

    // AirMax
    if airmax {
        lines.push("radio.1.pollingnoack=0".to_string());
        lines.push("radio.1.polling=enabled".to_string());
        lines.push("radio.1.polling.pbe=enabled".to_string());
    } else {
        lines.push("radio.1.polling=disabled".to_string());
    }

    // Wireless settings (AP mode)
    lines.push("wireless.1.status=enabled".to_string());
    lines.push("wireless.1.mode=ap".to_string());
    lines.push(format!("wireless.1.ssid={}", ssid));
    lines.push("wireless.1.hide_ssid=disabled".to_string());
    lines.push("wireless.1.security=wpa2".to_string());
    lines.push("wireless.1.wpa.mode=2".to_string());
    lines.push("wireless.1.wpa.psk=0".to_string());
    lines.push(format!("wireless.1.wpa.key={}", wpa_key));
    lines.push("wireless.1.addmtikie=enabled".to_string());
    lines.push("wireless.1.mac_acl.status=disabled".to_string());
    lines.push("wireless.1.mac_acl.policy=deny".to_string());

    // Network settings (bridge mode)
    lines.push("bridge.1.status=enabled".to_string());
    lines.push("bridge.1.port.1.devname=eth0".to_string());
    lines.push("bridge.1.port.2.devname=ath0".to_string());
    lines.push("bridge.1.stp.status=disabled".to_string());

    // Management IP
    lines.push("netconf.1.status=enabled".to_string());
    lines.push("netconf.1.autoip=disabled".to_string());
    lines.push(format!("netconf.1.ip={}", ip_addr));
    lines.push(format!("netconf.1.netmask={}", netmask));
    lines.push(format!("netconf.1.gateway={}", gateway));
    lines.push("netconf.1.up=enabled".to_string());

    // DNS
    lines.push("resolv.host.1.status=enabled".to_string());
    lines.push("resolv.nameserver.1.status=enabled".to_string());
    lines.push("resolv.nameserver.1.ip=8.8.8.8".to_string());
    lines.push("resolv.nameserver.2.status=enabled".to_string());
    lines.push("resolv.nameserver.2.ip=8.8.4.4".to_string());

    // System
    lines.push(format!("resolv.host.1.name={}", device_name));
    lines.push("httpd.https.status=enabled".to_string());
    lines.push("httpd.port=443".to_string());
    lines.push("sshd.status=enabled".to_string());
    lines.push("sshd.port=22".to_string());
    lines.push("ntpclient.status=enabled".to_string());
    lines.push("ntpclient.1.server=0.ubnt.pool.ntp.org".to_string());

    // Discovery
    lines.push("discovery.status=enabled".to_string());

    let config = lines.join("\n") + "\n";
    println!("[UBNT] AP config generated: {} lines", lines.len());
    config
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse CIDR notation "192.168.1.10/24" into ("192.168.1.10", "255.255.255.0")
/// If no prefix is given, assumes /24
fn parse_cidr(cidr: &str) -> (String, String) {
    if let Some(pos) = cidr.find('/') {
        let ip = cidr[..pos].to_string();
        let prefix: u32 = cidr[pos + 1..].parse().unwrap_or(24);
        let mask = if prefix == 0 {
            0u32
        } else {
            !0u32 << (32 - prefix)
        };
        let netmask = format!("{}.{}.{}.{}",
            (mask >> 24) & 0xFF,
            (mask >> 16) & 0xFF,
            (mask >> 8) & 0xFF,
            mask & 0xFF,
        );
        (ip, netmask)
    } else {
        (cidr.to_string(), "255.255.255.0".to_string())
    }
}

/// Convert UbntDevice to a serde_json::Value for Tauri commands
impl UbntDevice {
    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "mac": self.mac,
            "ip": self.ip,
            "model": self.model,
            "firmware": self.firmware,
            "hostname": self.hostname,
            "ssid": self.ssid,
            "is_default": self.is_default,
        })
    }
}
