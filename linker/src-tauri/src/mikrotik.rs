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
}
