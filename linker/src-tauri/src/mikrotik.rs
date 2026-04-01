use std::io::{Read, Write, BufReader, BufWriter};
use std::net::TcpStream;
use std::time::Duration;
use serde_json::Value;

pub struct MikroTikClient {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
}

pub struct MikroTikConnection {
    reader: BufReader<TcpStream>,
    writer: BufWriter<TcpStream>,
}

impl MikroTikClient {
    pub fn new(host: &str, port: u16, user: &str, password: &str) -> Self {
        Self {
            host: host.to_string(),
            port,
            user: user.to_string(),
            password: password.to_string(),
        }
    }

    /// Connect and authenticate to RouterOS
    pub fn connect(&self) -> Result<MikroTikConnection, String> {
        let addr = format!("{}:{}", self.host, self.port);
        println!("[MikroTik] Connecting to {}...", addr);

        let stream = TcpStream::connect_timeout(
            &addr.parse().map_err(|e| format!("Invalid address '{}': {}", addr, e))?,
            Duration::from_secs(5),
        ).map_err(|e| format!("TCP connect to {} failed: {}", addr, e))?;

        stream.set_read_timeout(Some(Duration::from_secs(10)))
            .map_err(|e| format!("Failed to set read timeout: {}", e))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))
            .map_err(|e| format!("Failed to set write timeout: {}", e))?;

        let reader = BufReader::new(stream.try_clone().map_err(|e| format!("Clone stream: {}", e))?);
        let writer = BufWriter::new(stream);

        let mut conn = MikroTikConnection { reader, writer };

        // Login (RouterOS 6.43+ plain text login)
        println!("[MikroTik] Authenticating as '{}'...", self.user);
        conn.send_sentence(&[
            "/login",
            &format!("=name={}", self.user),
            &format!("=password={}", self.password),
        ])?;

        let (sentences, _done) = conn.read_response()?;

        // Check for !trap (auth failure)
        for sentence in &sentences {
            if let Some(first) = sentence.first() {
                if first == "!trap" {
                    let msg = sentence.iter()
                        .find(|w| w.starts_with("=message="))
                        .map(|w| w[9..].to_string())
                        .unwrap_or_else(|| "Authentication failed".to_string());
                    return Err(format!("Login failed: {}", msg));
                }
                if first == "!fatal" {
                    let msg = sentence.get(1).cloned().unwrap_or_else(|| "Fatal error".to_string());
                    return Err(format!("Fatal: {}", msg));
                }
            }
        }

        println!("[MikroTik] Authenticated successfully");
        Ok(conn)
    }
}

impl MikroTikConnection {
    /// Write the length prefix for a word
    fn write_length(&mut self, len: usize) -> Result<(), String> {
        if len < 0x80 {
            self.writer.write_all(&[len as u8])
                .map_err(|e| format!("Write length: {}", e))
        } else if len < 0x4000 {
            let bytes = [
                (0x80 | ((len >> 8) & 0x3F)) as u8,
                (len & 0xFF) as u8,
            ];
            self.writer.write_all(&bytes)
                .map_err(|e| format!("Write length: {}", e))
        } else if len < 0x200000 {
            let bytes = [
                (0xC0 | ((len >> 16) & 0x1F)) as u8,
                ((len >> 8) & 0xFF) as u8,
                (len & 0xFF) as u8,
            ];
            self.writer.write_all(&bytes)
                .map_err(|e| format!("Write length: {}", e))
        } else if len < 0x10000000 {
            let bytes = [
                (0xE0 | ((len >> 24) & 0x0F)) as u8,
                ((len >> 16) & 0xFF) as u8,
                ((len >> 8) & 0xFF) as u8,
                (len & 0xFF) as u8,
            ];
            self.writer.write_all(&bytes)
                .map_err(|e| format!("Write length: {}", e))
        } else {
            Err(format!("Word too long: {} bytes", len))
        }
    }

    /// Read the length prefix for a word
    fn read_length(&mut self) -> Result<usize, String> {
        let mut byte = [0u8; 1];
        self.reader.read_exact(&mut byte)
            .map_err(|e| format!("Read length byte: {}", e))?;

        let first = byte[0];

        if first < 0x80 {
            Ok(first as usize)
        } else if first < 0xC0 {
            let mut b2 = [0u8; 1];
            self.reader.read_exact(&mut b2).map_err(|e| format!("Read length: {}", e))?;
            Ok((((first as usize) & 0x3F) << 8) | (b2[0] as usize))
        } else if first < 0xE0 {
            let mut b = [0u8; 2];
            self.reader.read_exact(&mut b).map_err(|e| format!("Read length: {}", e))?;
            Ok((((first as usize) & 0x1F) << 16) | ((b[0] as usize) << 8) | (b[1] as usize))
        } else if first < 0xF0 {
            let mut b = [0u8; 3];
            self.reader.read_exact(&mut b).map_err(|e| format!("Read length: {}", e))?;
            Ok((((first as usize) & 0x0F) << 24) | ((b[0] as usize) << 16) | ((b[1] as usize) << 8) | (b[2] as usize))
        } else {
            Err(format!("Unsupported length encoding: 0x{:02X}", first))
        }
    }

    /// Write a word (length-encoded string)
    fn write_word(&mut self, word: &str) -> Result<(), String> {
        self.write_length(word.len())?;
        if !word.is_empty() {
            self.writer.write_all(word.as_bytes())
                .map_err(|e| format!("Write word: {}", e))?;
        }
        Ok(())
    }

    /// Read a word
    fn read_word(&mut self) -> Result<String, String> {
        let len = self.read_length()?;
        if len == 0 {
            return Ok(String::new());
        }
        let mut buf = vec![0u8; len];
        self.reader.read_exact(&mut buf)
            .map_err(|e| format!("Read word ({} bytes): {}", len, e))?;
        String::from_utf8(buf)
            .map_err(|e| format!("Invalid UTF-8 in word: {}", e))
    }

    /// Send a sentence (list of words + empty word terminator)
    fn send_sentence(&mut self, words: &[&str]) -> Result<(), String> {
        for word in words {
            self.write_word(word)?;
        }
        // Empty word = end of sentence
        self.write_word("")?;
        self.writer.flush().map_err(|e| format!("Flush: {}", e))
    }

    /// Read a complete sentence (until empty word)
    fn read_sentence(&mut self) -> Result<Vec<String>, String> {
        let mut words = Vec::new();
        loop {
            let word = self.read_word()?;
            if word.is_empty() {
                break;
            }
            words.push(word);
        }
        Ok(words)
    }

    /// Read all sentences until !done or !trap/!fatal
    /// Returns (sentences, is_error)
    fn read_response(&mut self) -> Result<(Vec<Vec<String>>, bool), String> {
        let mut sentences = Vec::new();
        let mut is_error = false;

        loop {
            let sentence = self.read_sentence()?;
            if sentence.is_empty() {
                continue;
            }

            let first = sentence[0].as_str();
            match first {
                "!done" => {
                    sentences.push(sentence);
                    break;
                }
                "!trap" => {
                    is_error = true;
                    sentences.push(sentence);
                    // Keep reading until !done
                }
                "!fatal" => {
                    is_error = true;
                    sentences.push(sentence);
                    break;
                }
                _ => {
                    sentences.push(sentence);
                }
            }
        }

        Ok((sentences, is_error))
    }

    /// Parse a =key=value word into (key, value)
    fn parse_attribute(word: &str) -> Option<(String, String)> {
        if !word.starts_with('=') {
            return None;
        }
        let rest = &word[1..]; // strip leading =
        if let Some(pos) = rest.find('=') {
            let key = &rest[..pos];
            let value = &rest[pos + 1..];
            Some((key.to_string(), value.to_string()))
        } else {
            // =key with no value
            Some((rest.to_string(), String::new()))
        }
    }

    /// Send a command and return all response data rows as key-value pairs
    pub fn send_command(&mut self, command: &str, args: &[&str]) -> Result<Vec<Vec<(String, String)>>, String> {
        let mut words: Vec<&str> = vec![command];
        words.extend_from_slice(args);

        self.send_sentence(&words)?;

        let (sentences, is_error) = self.read_response()?;
        let mut results = Vec::new();

        for sentence in &sentences {
            if sentence.is_empty() {
                continue;
            }
            let first = sentence[0].as_str();

            if first == "!trap" {
                let msg = sentence.iter()
                    .find_map(|w| Self::parse_attribute(w).filter(|(k, _)| k == "message"))
                    .map(|(_, v)| v)
                    .unwrap_or_else(|| "Unknown error".to_string());
                if is_error && results.is_empty() {
                    return Err(format!("RouterOS error: {}", msg));
                }
            }

            if first == "!re" || first == "!done" {
                let pairs: Vec<(String, String)> = sentence[1..].iter()
                    .filter_map(|w| Self::parse_attribute(w))
                    .collect();
                if !pairs.is_empty() {
                    results.push(pairs);
                }
            }
        }

        Ok(results)
    }

    /// Convenience: send command and get results as JSON array
    pub fn query(&mut self, command: &str, args: &[&str]) -> Result<Vec<Value>, String> {
        let rows = self.send_command(command, args)?;
        let json_rows: Vec<Value> = rows.into_iter().map(|pairs| {
            let mut map = serde_json::Map::new();
            for (key, value) in pairs {
                map.insert(key, Value::String(value));
            }
            Value::Object(map)
        }).collect();
        Ok(json_rows)
    }
}

// Helper functions for common MikroTik operations
impl MikroTikConnection {
    pub fn get_system_resource(&mut self) -> Result<Value, String> {
        let results = self.query("/system/resource/print", &[])?;
        Ok(results.into_iter().next().unwrap_or(Value::Null))
    }

    pub fn get_identity(&mut self) -> Result<String, String> {
        let results = self.query("/system/identity/print", &[])?;
        if let Some(row) = results.first() {
            Ok(row.get("name").and_then(|v| v.as_str()).unwrap_or("unknown").to_string())
        } else {
            Ok("unknown".to_string())
        }
    }

    pub fn get_interfaces(&mut self) -> Result<Vec<Value>, String> {
        self.query("/interface/print", &[])
    }

    pub fn get_pppoe_profiles(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ppp/profile/print", &[])
    }

    pub fn get_pppoe_secrets(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ppp/secret/print", &[])
    }

    pub fn get_pppoe_active(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ppp/active/print", &[])
    }

    pub fn create_pppoe_secret(&mut self, name: &str, password: &str, profile: &str) -> Result<Value, String> {
        self.query("/ppp/secret/add", &[
            &format!("=name={}", name),
            &format!("=password={}", password),
            &format!("=profile={}", profile),
            "=service=pppoe",
        ])?;
        Ok(Value::Bool(true))
    }

    pub fn delete_pppoe_secret(&mut self, name: &str) -> Result<(), String> {
        let secrets = self.query("/ppp/secret/print", &[&format!("?name={}", name)])?;
        if let Some(secret) = secrets.first() {
            if let Some(id) = secret.get(".id") {
                let id_str = id.as_str().unwrap_or("");
                self.query("/ppp/secret/remove", &[&format!("=.id={}", id_str)])?;
            }
        }
        Ok(())
    }

    pub fn enable_pppoe_secret(&mut self, name: &str) -> Result<(), String> {
        let secrets = self.query("/ppp/secret/print", &[&format!("?name={}", name)])?;
        if let Some(secret) = secrets.first() {
            if let Some(id) = secret.get(".id") {
                let id_str = id.as_str().unwrap_or("");
                self.query("/ppp/secret/set", &[
                    &format!("=.id={}", id_str),
                    "=disabled=no",
                ])?;
            }
        }
        Ok(())
    }

    pub fn disable_pppoe_secret(&mut self, name: &str) -> Result<(), String> {
        let secrets = self.query("/ppp/secret/print", &[&format!("?name={}", name)])?;
        if let Some(secret) = secrets.first() {
            if let Some(id) = secret.get(".id") {
                let id_str = id.as_str().unwrap_or("");
                self.query("/ppp/secret/set", &[
                    &format!("=.id={}", id_str),
                    "=disabled=yes",
                ])?;
            }
        }
        Ok(())
    }

    pub fn get_firewall_filter(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ip/firewall/filter/print", &[])
    }

    pub fn get_firewall_nat(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ip/firewall/nat/print", &[])
    }

    pub fn get_queue_simple(&mut self) -> Result<Vec<Value>, String> {
        self.query("/queue/simple/print", &[])
    }

    pub fn get_queue_tree(&mut self) -> Result<Vec<Value>, String> {
        self.query("/queue/tree/print", &[])
    }

    pub fn get_ip_addresses(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ip/address/print", &[])
    }

    pub fn get_ip_pool(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ip/pool/print", &[])
    }

    pub fn get_dns(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ip/dns/print", &[])
    }

    pub fn get_arp_table(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ip/arp/print", &[])
    }

    pub fn get_dhcp_leases(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ip/dhcp-server/lease/print", &[])
    }

    pub fn get_routes(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ip/route/print", &[])
    }

    pub fn ping_address(&mut self, address: &str) -> Result<bool, String> {
        let results = self.query("/ping", &[
            &format!("=address={}", address),
            "=count=1",
            "=interval=1",
        ])?;
        if let Some(row) = results.first() {
            Ok(row.get("received").and_then(|v| v.as_str()) == Some("1"))
        } else {
            Ok(false)
        }
    }

    /// Ping with stats using interface name for proper WAN routing
    pub fn ping_extended(&mut self, address: &str, count: u32, interface: &str) -> Result<Value, String> {
        let mut args = vec![
            format!("=address={}", address),
            format!("=count={}", count),
            "=interval=1".to_string(),
        ];
        if !interface.is_empty() {
            args.push(format!("=interface={}", interface));
        }
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

        println!("[Ping] /ping args: {:?}", arg_refs);
        let results = self.query("/ping", &arg_refs)?;
        // RouterOS 7 returns one row per packet, each with cumulative sent/received
        // and per-packet "time" field like "20ms955us"
        // Use the last row for sent/received totals, collect each "time" for stats
        let mut times: Vec<f64> = Vec::new();

        for row in &results {
            if let Some(time_str) = row.get("time").and_then(|v| v.as_str()) {
                if let Some(ms) = Self::parse_time_ms(time_str) {
                    times.push(ms);
                }
            }
        }

        // Last row has cumulative sent/received
        let last = results.last();
        let sent: u32 = last.and_then(|r| r.get("sent")).and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok()).unwrap_or(count);
        let received: u32 = last.and_then(|r| r.get("received")).and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok()).unwrap_or(0);

        let avg = if times.is_empty() { 0.0 } else { times.iter().sum::<f64>() / times.len() as f64 };
        let min = times.iter().cloned().fold(f64::MAX, f64::min);
        let max = times.iter().cloned().fold(0.0f64, f64::max);
        let loss = if sent > 0 { ((sent - received) as f64 / sent as f64) * 100.0 } else { 100.0 };

        Ok(serde_json::json!({
            "avg_ms": (avg * 100.0).round() / 100.0,
            "min_ms": if min == f64::MAX { 0.0 } else { (min * 100.0).round() / 100.0 },
            "max_ms": (max * 100.0).round() / 100.0,
            "sent": sent,
            "received": received,
            "loss_pct": (loss * 100.0).round() / 100.0,
        }))
    }

    /// Parse RouterOS time string: "20ms955us", "23ms", "500us", "1s234ms"
    fn parse_time_ms(s: &str) -> Option<f64> {
        let s = s.trim();
        let mut total_ms = 0.0f64;
        let mut remaining = s;

        // Extract seconds part: "1s..."
        if let Some(idx) = remaining.find('s') {
            // Make sure it's not "ms" or "us"
            if idx > 0 && !remaining[..idx].ends_with('m') && !remaining[..idx].ends_with('u') {
                if let Ok(secs) = remaining[..idx].parse::<f64>() {
                    total_ms += secs * 1000.0;
                }
                remaining = &remaining[idx + 1..];
            }
        }

        // Extract ms part: "20ms..."
        if let Some(idx) = remaining.find("ms") {
            if let Ok(ms) = remaining[..idx].parse::<f64>() {
                total_ms += ms;
            }
            remaining = &remaining[idx + 2..];
        }

        // Extract us part: "955us"
        if let Some(idx) = remaining.find("us") {
            if let Ok(us) = remaining[..idx].parse::<f64>() {
                total_ms += us / 1000.0;
            }
        }

        // If nothing matched, try plain number
        if total_ms == 0.0 {
            if let Ok(v) = s.parse::<f64>() {
                return Some(v);
            }
        }

        if total_ms > 0.0 { Some(total_ms) } else { None }
    }

    /// Fetch URL for speed test — returns duration and bytes
    pub fn fetch_speed_test(&mut self, url: &str, _interface: &str) -> Result<Value, String> {
        // RouterOS 7 /tool/fetch with keep-result=no: download but don't save
        // Note: src-interface is not a valid param in all versions, let routing handle it
        let args = vec![
            format!("=url={}", url),
            "=keep-result=no".to_string(),
        ];
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

        println!("[Fetch] /tool/fetch args: {:?}", arg_refs);
        let results = self.query("/tool/fetch", &arg_refs)?;
        println!("[Fetch] Got {} rows", results.len());

        // RouterOS returns progress rows; the last one with "finished" has final stats
        // downloaded is in KiB, duration is like "4s" or "1s500ms"
        let finished_row = results.iter().rev()
            .find(|r| r.get("status").and_then(|v| v.as_str()) == Some("finished"));

        if let Some(row) = finished_row {
            let duration_str = row.get("duration").and_then(|v| v.as_str()).unwrap_or("0");
            let downloaded_kib = row.get("downloaded").and_then(|v| v.as_str()).unwrap_or("0");
            let total_kib = row.get("total").and_then(|v| v.as_str()).unwrap_or("0");

            println!("[Fetch] Finished: downloaded={}KiB total={}KiB duration={}", downloaded_kib, total_kib, duration_str);

            Ok(serde_json::json!({
                "status": "finished",
                "duration": duration_str,
                "downloaded": downloaded_kib,
                "total": total_kib,
            }))
        } else {
            let last = results.last();
            let status = last.and_then(|r| r.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
            Err(format!("Fetch did not finish, last status: {}", status))
        }
    }

    /// Bandwidth test (requires btest server or another MikroTik)
    pub fn bandwidth_test(&mut self, address: &str, protocol: &str, direction: &str, duration: &str) -> Result<Vec<Value>, String> {
        self.query("/tool/bandwidth-test", &[
            &format!("=address={}", address),
            &format!("=protocol={}", protocol),
            &format!("=direction={}", direction),
            &format!("=duration={}", duration),
        ])
    }

    pub fn ssh_exec(&mut self, address: &str, user: &str, password: &str, command: &str) -> Result<(String, i32), String> {
        let results = self.query("/system/ssh-exec", &[
            &format!("=address={}", address),
            &format!("=user={}", user),
            &format!("=password={}", password),
            &format!("=command={}", command),
        ])?;
        if let Some(row) = results.first() {
            let output = row.get("output").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let exit_code: i32 = row.get("exit-code")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse().ok())
                .unwrap_or(-1);
            Ok((output, exit_code))
        } else {
            Err("No response from ssh-exec".to_string())
        }
    }

    pub fn add_firewall_filter(&mut self, args: &[&str]) -> Result<Value, String> {
        self.query("/ip/firewall/filter/add", args)
            .map(|r| r.into_iter().next().unwrap_or(Value::Null))
    }

    pub fn remove_firewall_filter(&mut self, id: &str) -> Result<(), String> {
        self.query("/ip/firewall/filter/remove", &[&format!("=.id={}", id)])?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // WISP Protection methods — mangle, NAT, raw, L7, DNS static, scripts
    // -----------------------------------------------------------------------

    /// Add mangle rule (for TTL manipulation, packet marking, MSS clamp)
    pub fn add_mangle_rule(&mut self, args: &[&str]) -> Result<Value, String> {
        self.query("/ip/firewall/mangle/add", args)
            .map(|r| r.into_iter().next().unwrap_or(Value::Null))
    }

    /// Get all mangle rules
    pub fn get_mangle_rules(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ip/firewall/mangle/print", &[])
    }

    /// Remove mangle rule by ID
    pub fn remove_mangle_rule(&mut self, id: &str) -> Result<(), String> {
        self.query("/ip/firewall/mangle/remove", &[&format!("=.id={}", id)])?;
        Ok(())
    }

    /// Add NAT rule (for DNS redirect, port forwarding, hairpin)
    pub fn add_nat_rule(&mut self, args: &[&str]) -> Result<Value, String> {
        self.query("/ip/firewall/nat/add", args)
            .map(|r| r.into_iter().next().unwrap_or(Value::Null))
    }

    /// Remove NAT rule by ID
    pub fn remove_nat_rule(&mut self, id: &str) -> Result<(), String> {
        self.query("/ip/firewall/nat/remove", &[&format!("=.id={}", id)])?;
        Ok(())
    }

    /// Add raw firewall rule (for bogon filtering, pre-routing drops)
    pub fn add_raw_rule(&mut self, args: &[&str]) -> Result<Value, String> {
        self.query("/ip/firewall/raw/add", args)
            .map(|r| r.into_iter().next().unwrap_or(Value::Null))
    }

    /// Get all raw rules
    pub fn get_raw_rules(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ip/firewall/raw/print", &[])
    }

    /// Remove raw rule by ID
    pub fn remove_raw_rule(&mut self, id: &str) -> Result<(), String> {
        self.query("/ip/firewall/raw/remove", &[&format!("=.id={}", id)])?;
        Ok(())
    }

    /// Add Layer-7 protocol definition (for torrent/P2P detection)
    pub fn add_layer7_protocol(&mut self, args: &[&str]) -> Result<Value, String> {
        self.query("/ip/firewall/layer7-protocol/add", args)
            .map(|r| r.into_iter().next().unwrap_or(Value::Null))
    }

    /// Get all Layer-7 protocols
    pub fn get_layer7_protocols(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ip/firewall/layer7-protocol/print", &[])
    }

    /// Remove Layer-7 protocol by ID
    pub fn remove_layer7_protocol(&mut self, id: &str) -> Result<(), String> {
        self.query("/ip/firewall/layer7-protocol/remove", &[&format!("=.id={}", id)])?;
        Ok(())
    }

    /// Add DNS static entry (for domain blocking)
    pub fn add_dns_static(&mut self, args: &[&str]) -> Result<Value, String> {
        self.query("/ip/dns/static/add", args)
            .map(|r| r.into_iter().next().unwrap_or(Value::Null))
    }

    /// Get all DNS static entries
    pub fn get_dns_static(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ip/dns/static/print", &[])
    }

    /// Remove DNS static entry by ID
    pub fn remove_dns_static(&mut self, id: &str) -> Result<(), String> {
        self.query("/ip/dns/static/remove", &[&format!("=.id={}", id)])?;
        Ok(())
    }

    /// Add address list entry (for DoH blocking, heavy users, blacklists)
    pub fn add_address_list(&mut self, args: &[&str]) -> Result<Value, String> {
        self.query("/ip/firewall/address-list/add", args)
            .map(|r| r.into_iter().next().unwrap_or(Value::Null))
    }

    /// Get all address list entries
    pub fn get_address_list(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ip/firewall/address-list/print", &[])
    }

    /// Remove address list entry by ID
    pub fn remove_address_list(&mut self, id: &str) -> Result<(), String> {
        self.query("/ip/firewall/address-list/remove", &[&format!("=.id={}", id)])?;
        Ok(())
    }

    /// Add script (for anti-stow keepalive, automation)
    pub fn add_script(&mut self, args: &[&str]) -> Result<Value, String> {
        self.query("/system/script/add", args)
            .map(|r| r.into_iter().next().unwrap_or(Value::Null))
    }

    /// Get all scripts
    pub fn get_scripts(&mut self) -> Result<Vec<Value>, String> {
        self.query("/system/script/print", &[])
    }

    /// Remove script by ID
    pub fn remove_script(&mut self, id: &str) -> Result<(), String> {
        self.query("/system/script/remove", &[&format!("=.id={}", id)])?;
        Ok(())
    }

    /// Add scheduler (for periodic tasks like anti-stow)
    pub fn add_scheduler(&mut self, args: &[&str]) -> Result<Value, String> {
        self.query("/system/scheduler/add", args)
            .map(|r| r.into_iter().next().unwrap_or(Value::Null))
    }

    /// Get all schedulers
    pub fn get_schedulers(&mut self) -> Result<Vec<Value>, String> {
        self.query("/system/scheduler/print", &[])
    }

    /// Remove scheduler by ID
    pub fn remove_scheduler(&mut self, id: &str) -> Result<(), String> {
        self.query("/system/scheduler/remove", &[&format!("=.id={}", id)])?;
        Ok(())
    }

    /// Add netwatch entry (for monitoring connectivity)
    pub fn add_netwatch(&mut self, args: &[&str]) -> Result<Value, String> {
        self.query("/tool/netwatch/add", args)
            .map(|r| r.into_iter().next().unwrap_or(Value::Null))
    }

    /// Get all netwatch entries
    pub fn get_netwatch(&mut self) -> Result<Vec<Value>, String> {
        self.query("/tool/netwatch/print", &[])
    }

    /// Remove netwatch entry by ID
    pub fn remove_netwatch(&mut self, id: &str) -> Result<(), String> {
        self.query("/tool/netwatch/remove", &[&format!("=.id={}", id)])?;
        Ok(())
    }

    /// Set connection tracking parameters
    pub fn set_connection_tracking(&mut self, args: &[&str]) -> Result<(), String> {
        self.query("/ip/firewall/connection/tracking/set", args)?;
        Ok(())
    }

    /// Set IP service parameters (restrict access)
    pub fn set_ip_service(&mut self, service: &str, args: &[&str]) -> Result<(), String> {
        // First find the service
        let services = self.query("/ip/service/print", &[&format!("?name={}", service)])?;
        if let Some(svc) = services.first() {
            if let Some(id) = svc.get(".id").and_then(|v| v.as_str()) {
                let mut full_args: Vec<String> = vec![format!("=.id={}", id)];
                full_args.extend(args.iter().map(|a| a.to_string()));
                let refs: Vec<&str> = full_args.iter().map(|s| s.as_str()).collect();
                self.query("/ip/service/set", &refs)?;
            }
        }
        Ok(())
    }

    /// Add queue tree (for gaming priority, traffic shaping)
    pub fn add_queue_tree(&mut self, args: &[&str]) -> Result<Value, String> {
        self.query("/queue/tree/add", args)
            .map(|r| r.into_iter().next().unwrap_or(Value::Null))
    }

    /// Remove queue tree by ID
    pub fn remove_queue_tree(&mut self, id: &str) -> Result<(), String> {
        self.query("/queue/tree/remove", &[&format!("=.id={}", id)])?;
        Ok(())
    }

    /// Add route
    pub fn add_route(&mut self, args: &[&str]) -> Result<Value, String> {
        self.query("/ip/route/add", args)
            .map(|r| r.into_iter().next().unwrap_or(Value::Null))
    }

    /// Remove route by ID
    pub fn remove_route(&mut self, id: &str) -> Result<(), String> {
        self.query("/ip/route/remove", &[&format!("=.id={}", id)])?;
        Ok(())
    }

    /// Remove netwatch entry by comment prefix
    pub fn remove_netwatch_by_comment(&mut self, prefix: &str) -> Result<(), String> {
        let entries = self.get_netwatch()?;
        for e in &entries {
            let comment = e.get("comment").and_then(|v| v.as_str()).unwrap_or("");
            if comment.starts_with(prefix) {
                if let Some(id) = e.get(".id").and_then(|v| v.as_str()) {
                    self.remove_netwatch(id)?;
                }
            }
        }
        Ok(())
    }

    /// Add IPv6 mangle rule (for hop-limit manipulation)
    pub fn add_ipv6_mangle_rule(&mut self, args: &[&str]) -> Result<Value, String> {
        self.query("/ipv6/firewall/mangle/add", args)
            .map(|r| r.into_iter().next().unwrap_or(Value::Null))
    }

    /// Get IPv6 mangle rules
    pub fn get_ipv6_mangle_rules(&mut self) -> Result<Vec<Value>, String> {
        self.query("/ipv6/firewall/mangle/print", &[])
    }

    /// Remove IPv6 mangle rule by ID
    pub fn remove_ipv6_mangle_rule(&mut self, id: &str) -> Result<(), String> {
        self.query("/ipv6/firewall/mangle/remove", &[&format!("=.id={}", id)])?;
        Ok(())
    }
}
