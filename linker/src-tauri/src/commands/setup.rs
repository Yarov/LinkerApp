use crate::db::Database;
use crate::mikrotik::{MikroTikClient, MikroTikConnection};
use tauri::State;

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

/// Helper: get a string field from a JSON Value
fn jstr(v: &serde_json::Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

/// Detected network topology from the live MikroTik — no hardcoded IPs.
/// All firewall/security rules MUST use these values instead of constants.
struct DetectedSubnets {
    /// Management/LAN subnet in CIDR, e.g. "192.168.1.0/24"
    management_subnet: String,
    /// PPPoE/client subnet in CIDR, e.g. "10.0.0.0/24"
    client_subnet: String,
    /// VPN subnet in CIDR (WireGuard), e.g. "10.10.10.0/24"; empty if none
    vpn_subnet: String,
}

/// Read REAL subnets from MikroTik. Never hardcode IPs.
fn detect_subnets(mt: &mut MikroTikConnection) -> DetectedSubnets {
    let addresses = mt.get_ip_addresses().unwrap_or_default();
    let pools = mt.get_ip_pool().unwrap_or_default();
    let interfaces = mt.get_interfaces().unwrap_or_default();

    // --- Management subnet: IP on bridge or LAN interface ---
    let mut management_subnet = String::new();
    // Prefer bridge-lan, then any bridge, then any non-WAN ether
    for preferred in &["bridge-lan", "bridge"] {
        for addr in &addresses {
            let iface = jstr(addr, "interface");
            if iface == *preferred {
                let full = jstr(addr, "address"); // e.g. "192.168.1.1/24"
                if let Some(cidr) = ip_to_network_cidr(&full) {
                    management_subnet = cidr;
                    break;
                }
            }
        }
        if !management_subnet.is_empty() { break; }
    }
    // Fallback: any interface that is a bridge type
    if management_subnet.is_empty() {
        let bridge_names: Vec<String> = interfaces.iter()
            .filter(|i| jstr(i, "type") == "bridge")
            .map(|i| jstr(i, "name"))
            .collect();
        for addr in &addresses {
            let iface = jstr(addr, "interface");
            if bridge_names.contains(&iface) {
                let full = jstr(addr, "address");
                if let Some(cidr) = ip_to_network_cidr(&full) {
                    management_subnet = cidr;
                    break;
                }
            }
        }
    }

    // --- Client subnet: from pool-clientes or any pool ---
    let mut client_subnet = String::new();
    let client_pool = pools.iter()
        .find(|p| jstr(p, "name") == "pool-clientes")
        .or_else(|| pools.first());
    if let Some(pool) = client_pool {
        let ranges = jstr(pool, "ranges"); // e.g. "10.0.0.10-10.0.0.250"
        if let Some(first_ip) = ranges.split('-').next() {
            let octets: Vec<&str> = first_ip.trim().split('.').collect();
            if octets.len() == 4 {
                // Detect prefix from pool range
                client_subnet = format!("{}.{}.{}.0/24", octets[0], octets[1], octets[2]);
            }
        }
    }

    // --- VPN subnet: WireGuard interface IP ---
    let mut vpn_subnet = String::new();
    for addr in &addresses {
        let iface = jstr(addr, "interface");
        // WireGuard interfaces are usually named wg* or wireguard*
        let is_wg = interfaces.iter().any(|i| {
            jstr(i, "name") == iface && (jstr(i, "type") == "wg" || jstr(i, "type") == "wireguard" || iface.starts_with("wg"))
        });
        if is_wg {
            let full = jstr(addr, "address");
            if let Some(cidr) = ip_to_network_cidr(&full) {
                vpn_subnet = cidr;
                break;
            }
        }
    }

    println!("[DetectSubnets] management={}, client={}, vpn={}",
        if management_subnet.is_empty() { "(none)" } else { &management_subnet },
        if client_subnet.is_empty() { "(none)" } else { &client_subnet },
        if vpn_subnet.is_empty() { "(none)" } else { &vpn_subnet },
    );

    DetectedSubnets {
        management_subnet,
        client_subnet,
        vpn_subnet,
    }
}

/// Convert "192.168.1.1/24" to "192.168.1.0/24" (network CIDR)
fn ip_to_network_cidr(addr_with_prefix: &str) -> Option<String> {
    let parts: Vec<&str> = addr_with_prefix.split('/').collect();
    if parts.len() != 2 { return None; }
    let ip = parts[0];
    let prefix = parts[1];
    let octets: Vec<&str> = ip.split('.').collect();
    if octets.len() != 4 { return None; }
    // For /24, zero out last octet; for /16, zero out last two, etc.
    let prefix_num: u8 = prefix.parse().ok()?;
    if prefix_num >= 24 {
        Some(format!("{}.{}.{}.0/{}", octets[0], octets[1], octets[2], prefix))
    } else if prefix_num >= 16 {
        Some(format!("{}.{}.0.0/{}", octets[0], octets[1], prefix))
    } else {
        Some(format!("{}.0.0.0/{}", octets[0], prefix))
    }
}

/// Read SSH credentials from DB settings, with fallback defaults for Ubiquiti devices
fn get_ssh_credentials(db_path: &std::path::Path) -> Vec<(String, String)> {
    let mut creds = Vec::new();
    if let Ok(conn) = rusqlite::Connection::open(db_path) {
        let user = get_setting(&conn, "antenna_ssh_user");
        let pass = get_setting(&conn, "antenna_ssh_password");
        if !user.is_empty() {
            creds.push((user, pass));
        }
    }
    // Fallback defaults (try in order)
    creds.push(("ubnt".to_string(), "ubnt".to_string()));
    creds.push(("admin".to_string(), String::new()));
    creds.push(("admin".to_string(), "admin".to_string()));
    creds
}

// ---------------------------------------------------------------------------
// 1. analyze_mikrotik — complete analysis of current MikroTik config
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn analyze_mikrotik(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;

        match client.connect() {
            Ok(mut mt) => {
                println!("[Setup:Analyze] Connected to MikroTik");

                // System info
                let identity = mt.get_identity().unwrap_or_else(|_| "unknown".to_string());
                let resource = mt.get_system_resource().unwrap_or(serde_json::Value::Null);
                let version = jstr(&resource, "version");
                let board = jstr(&resource, "board-name");

                println!("[Setup:Analyze] Identity={}, Version={}, Board={}", identity, version, board);

                // Interfaces
                let interfaces = mt.get_interfaces().unwrap_or_default();
                let ethernet_ifaces: Vec<&serde_json::Value> = interfaces.iter()
                    .filter(|i| jstr(i, "type") == "ether")
                    .collect();
                let bridge_ifaces: Vec<&serde_json::Value> = interfaces.iter()
                    .filter(|i| jstr(i, "type") == "bridge")
                    .collect();

                // IP addresses
                let ip_addresses = mt.get_ip_addresses().unwrap_or_default();

                // Routes — detect WAN
                let routes = mt.get_routes().unwrap_or_default();
                let default_route = routes.iter().find(|r| {
                    jstr(r, "dst-address") == "0.0.0.0/0"
                });
                let wan_gateway = default_route.map(|r| jstr(r, "gateway")).unwrap_or_default();
                let wan_interface_from_route = default_route.map(|r| jstr(r, "interface")).unwrap_or_default();

                // DHCP clients — another way to detect WAN
                let dhcp_clients = mt.query("/ip/dhcp-client/print", &[]).unwrap_or_default();
                let wan_dhcp_iface = dhcp_clients.first().map(|d| jstr(d, "interface")).unwrap_or_default();

                // Determine WAN interface
                let wan_interface = if !wan_dhcp_iface.is_empty() {
                    wan_dhcp_iface.clone()
                } else if !wan_interface_from_route.is_empty() {
                    wan_interface_from_route.clone()
                } else {
                    String::new()
                };

                // Detect WAN type
                let wan_type = if !wan_dhcp_iface.is_empty() {
                    "dhcp"
                } else {
                    // Check for PPPoE client
                    let pppoe_clients = mt.query("/interface/pppoe-client/print", &[]).unwrap_or_default();
                    if !pppoe_clients.is_empty() {
                        "pppoe"
                    } else if !wan_gateway.is_empty() {
                        "static"
                    } else {
                        "unknown"
                    }
                };

                println!("[Setup:Analyze] WAN: interface={}, type={}", wan_interface, wan_type);

                // DHCP servers
                let dhcp_servers = mt.query("/ip/dhcp-server/print", &[]).unwrap_or_default();

                // PPPoE servers
                let pppoe_servers = mt.query("/interface/pppoe-server/server/print", &[]).unwrap_or_default();

                // NAT rules
                let nat_rules = mt.get_firewall_nat().unwrap_or_default();
                let has_masquerade = nat_rules.iter().any(|r| jstr(r, "action") == "masquerade");

                // Firewall rules
                let fw_rules = mt.get_firewall_filter().unwrap_or_default();

                // DNS
                let dns = mt.get_dns().unwrap_or_default();
                let dns_servers = dns.first().map(|d| jstr(d, "servers")).unwrap_or_default();

                // PPP profiles
                let ppp_profiles = mt.get_pppoe_profiles().unwrap_or_default();

                // IP pools
                let ip_pools = mt.get_ip_pool().unwrap_or_default();

                // Bridge ports
                let bridge_ports = mt.query("/interface/bridge/port/print", &[]).unwrap_or_default();

                // Interface lists
                let iface_lists = mt.query("/interface/list/print", &[]).unwrap_or_default();
                let iface_list_members = mt.query("/interface/list/member/print", &[]).unwrap_or_default();

                // Determine if fresh/default config
                let is_fresh = fw_rules.is_empty()
                    && nat_rules.is_empty()
                    && pppoe_servers.is_empty()
                    && dhcp_servers.is_empty()
                    && ip_addresses.len() <= 1;

                let is_configured = !pppoe_servers.is_empty()
                    || fw_rules.len() > 5
                    || has_masquerade;

                let config_status = if is_fresh {
                    "fresh"
                } else if is_configured {
                    "configured"
                } else {
                    "partial"
                };

                println!("[Setup:Analyze] Config status: {}", config_status);

                // Build LAN interfaces list
                let lan_interfaces: Vec<serde_json::Value> = ethernet_ifaces.iter()
                    .filter(|i| jstr(i, "name") != wan_interface)
                    .map(|i| {
                        serde_json::json!({
                            "name": jstr(i, "name"),
                            "type": "ether",
                            "running": jstr(i, "running") == "true",
                            "mac": jstr(i, "mac-address"),
                        })
                    })
                    .collect();

                let ip_info: Vec<serde_json::Value> = ip_addresses.iter().map(|a| {
                    serde_json::json!({
                        "address": jstr(a, "address"),
                        "interface": jstr(a, "interface"),
                        "network": jstr(a, "network"),
                        "disabled": jstr(a, "disabled") == "true",
                    })
                }).collect();

                Ok(serde_json::json!({
                    "connected": true,
                    "system": {
                        "identity": identity,
                        "version": version,
                        "board": board,
                        "architecture": jstr(&resource, "architecture-name"),
                        "cpu": jstr(&resource, "cpu"),
                        "cpu_count": jstr(&resource, "cpu-count"),
                        "total_memory": jstr(&resource, "total-memory"),
                        "free_memory": jstr(&resource, "free-memory"),
                        "uptime": jstr(&resource, "uptime"),
                    },
                    "wan": {
                        "interface": wan_interface,
                        "type": wan_type,
                        "gateway": wan_gateway,
                        "dhcp_clients": dhcp_clients,
                    },
                    "lan": {
                        "interfaces": lan_interfaces,
                        "bridges": bridge_ifaces.iter().map(|b| serde_json::json!({
                            "name": jstr(b, "name"),
                            "running": jstr(b, "running") == "true",
                        })).collect::<Vec<_>>(),
                        "bridge_ports": bridge_ports,
                    },
                    "ip_addresses": ip_info,
                    "dhcp_servers": dhcp_servers,
                    "pppoe_servers": pppoe_servers,
                    "ppp_profiles": ppp_profiles,
                    "ip_pools": ip_pools,
                    "nat_rules": {
                        "count": nat_rules.len(),
                        "has_masquerade": has_masquerade,
                        "rules": nat_rules,
                    },
                    "firewall_rules": {
                        "count": fw_rules.len(),
                        "linker_rules": fw_rules.iter().filter(|r| {
                            r.get("comment").and_then(|v| v.as_str()).unwrap_or("").starts_with("LK: ")
                        }).count(),
                    },
                    "dns": {
                        "servers": dns_servers,
                        "allow_remote": dns.first().map(|d| jstr(d, "allow-remote-requests")).unwrap_or_default(),
                    },
                    "interface_lists": iface_lists,
                    "interface_list_members": iface_list_members,
                    "config_status": config_status,
                    "total_ethernet": ethernet_ifaces.len(),
                    "total_interfaces": interfaces.len(),
                }))
            }
            Err(e) => {
                println!("[Setup:Analyze] Connection failed: {}", e);
                Ok(serde_json::json!({
                    "connected": false,
                    "error": format!("No se pudo conectar: {}", e),
                }))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// 2. setup_wan — configure WAN (internet) interface
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn setup_wan(
    db: State<'_, Database>,
    wan_interface: String,
    wan_type: String,
    pppoe_user: Option<String>,
    pppoe_password: Option<String>,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;
        let mut steps: Vec<serde_json::Value> = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        match client.connect() {
            Ok(mut mt) => {
                println!("[Setup:WAN] Configuring WAN: interface={}, type={}", wan_interface, wan_type);

                match wan_type.as_str() {
                    "dhcp" => {
                        // Remove existing DHCP client on this interface if any
                        if let Ok(existing) = mt.query("/ip/dhcp-client/print", &[
                            &format!("?interface={}", wan_interface),
                        ]) {
                            for item in &existing {
                                if let Some(id) = item.get(".id").and_then(|v| v.as_str()) {
                                    println!("[Setup:WAN] Removing existing DHCP client on {}", wan_interface);
                                    mt.query("/ip/dhcp-client/remove", &[&format!("=.id={}", id)]).ok();
                                }
                            }
                        }

                        // Add DHCP client
                        println!("[Setup:WAN] Adding DHCP client on {}", wan_interface);
                        match mt.query("/ip/dhcp-client/add", &[
                            &format!("=interface={}", wan_interface),
                            "=disabled=no",
                            "=add-default-route=yes",
                            "=use-peer-dns=yes",
                            &format!("=comment=LK: WAN DHCP client"),
                        ]) {
                            Ok(_) => {
                                println!("[Setup:WAN] OK: DHCP client added");
                                steps.push(serde_json::json!({
                                    "step": "dhcp_client",
                                    "status": "ok",
                                    "description": format!("DHCP client on {}", wan_interface),
                                }));
                            }
                            Err(e) => {
                                println!("[Setup:WAN] ERROR: DHCP client: {}", e);
                                errors.push(format!("DHCP client: {}", e));
                                steps.push(serde_json::json!({
                                    "step": "dhcp_client", "status": "error", "description": e,
                                }));
                            }
                        }
                    }
                    "pppoe" => {
                        let user = pppoe_user.unwrap_or_else(|| "user".to_string());
                        let pass = pppoe_password.unwrap_or_default();

                        // Remove existing PPPoE client if any
                        if let Ok(existing) = mt.query("/interface/pppoe-client/print", &[]) {
                            for item in &existing {
                                let name = jstr(item, "name");
                                if let Some(id) = item.get(".id").and_then(|v| v.as_str()) {
                                    println!("[Setup:WAN] Removing existing PPPoE client {}", name);
                                    mt.query("/interface/pppoe-client/remove", &[&format!("=.id={}", id)]).ok();
                                }
                            }
                        }

                        // Create PPPoE client
                        println!("[Setup:WAN] Creating PPPoE client on {} (user={})", wan_interface, user);
                        match mt.query("/interface/pppoe-client/add", &[
                            "=name=pppoe-wan",
                            &format!("=interface={}", wan_interface),
                            &format!("=user={}", user),
                            &format!("=password={}", pass),
                            "=disabled=no",
                            "=add-default-route=yes",
                            "=use-peer-dns=yes",
                            &format!("=comment=LK: WAN PPPoE client"),
                        ]) {
                            Ok(_) => {
                                println!("[Setup:WAN] OK: PPPoE client created");
                                steps.push(serde_json::json!({
                                    "step": "pppoe_client",
                                    "status": "ok",
                                    "description": format!("PPPoE client on {} (user={})", wan_interface, user),
                                }));
                            }
                            Err(e) => {
                                println!("[Setup:WAN] ERROR: PPPoE client: {}", e);
                                errors.push(format!("PPPoE client: {}", e));
                                steps.push(serde_json::json!({
                                    "step": "pppoe_client", "status": "error", "description": e,
                                }));
                            }
                        }
                    }
                    "static" => {
                        // For static, the IP should already be set or will be set in LAN setup
                        println!("[Setup:WAN] Static WAN - no DHCP/PPPoE needed");
                        steps.push(serde_json::json!({
                            "step": "static_wan",
                            "status": "ok",
                            "description": format!("Static WAN on {} (configure IP manually)", wan_interface),
                        }));
                    }
                    _ => {
                        errors.push(format!("Unknown WAN type: {}", wan_type));
                    }
                }

                // Ensure interface lists exist
                for list_name in &["WAN", "LAN"] {
                    if let Ok(lists) = mt.query("/interface/list/print", &[
                        &format!("?name={}", list_name),
                    ]) {
                        if lists.is_empty() {
                            println!("[Setup:WAN] Creating interface list: {}", list_name);
                            mt.query("/interface/list/add", &[
                                &format!("=name={}", list_name),
                                &format!("=comment=LK: {} list", list_name),
                            ]).ok();
                        }
                    }
                }

                // Add WAN interface to WAN list
                // For PPPoE, the WAN list member should be the pppoe-wan interface
                let wan_list_iface = if wan_type == "pppoe" {
                    "pppoe-wan".to_string()
                } else {
                    wan_interface.clone()
                };

                // Remove existing WAN list member for this interface
                if let Ok(members) = mt.query("/interface/list/member/print", &[
                    "?list=WAN",
                ]) {
                    for m in &members {
                        if let Some(id) = m.get(".id").and_then(|v| v.as_str()) {
                            mt.query("/interface/list/member/remove", &[&format!("=.id={}", id)]).ok();
                        }
                    }
                }

                println!("[Setup:WAN] Adding {} to WAN list", wan_list_iface);
                match mt.query("/interface/list/member/add", &[
                    &format!("=interface={}", wan_list_iface),
                    "=list=WAN",
                    &format!("=comment=LK: WAN member"),
                ]) {
                    Ok(_) => {
                        println!("[Setup:WAN] OK: {} added to WAN list", wan_list_iface);
                        steps.push(serde_json::json!({
                            "step": "wan_list",
                            "status": "ok",
                            "description": format!("{} added to WAN list", wan_list_iface),
                        }));
                    }
                    Err(e) => {
                        println!("[Setup:WAN] ERROR: WAN list: {}", e);
                        errors.push(format!("WAN list: {}", e));
                        steps.push(serde_json::json!({
                            "step": "wan_list", "status": "error", "description": e,
                        }));
                    }
                }

                let success = errors.is_empty();
                log_to_db(&db_path, "setup_wan", if success { "OK" } else { "PARTIAL" },
                    &format!("WAN setup: {} steps, {} errors", steps.len(), errors.len()),
                    Some(&serde_json::to_string(&steps).unwrap_or_default()));

                Ok(serde_json::json!({
                    "success": success,
                    "steps": steps,
                    "errors": errors,
                }))
            }
            Err(e) => {
                println!("[Setup:WAN] Connection failed: {}", e);
                Ok(serde_json::json!({
                    "success": false,
                    "error": format!("No se pudo conectar: {}", e),
                }))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// 3. setup_lan — configure LAN bridge, management IP, pools
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn setup_lan(
    db: State<'_, Database>,
    management_subnet: String,
    client_pool_start: String,
    client_pool_end: String,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;
        let mut steps: Vec<serde_json::Value> = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        match client.connect() {
            Ok(mut mt) => {
                println!("[Setup:LAN] Configuring LAN: subnet={}, pool={}-{}",
                    management_subnet, client_pool_start, client_pool_end);

                // Parse management subnet to extract gateway IP
                // Expected format: "192.168.1.0/24" or "192.168.1.1/24"
                let (mgmt_gateway, mgmt_prefix) = parse_subnet_gateway(&management_subnet);
                let mgmt_address = format!("{}/{}", mgmt_gateway, mgmt_prefix);

                // 1. Create bridge-lan (or verify it exists)
                println!("[Setup:LAN] Creating bridge-lan...");
                let bridge_exists = mt.query("/interface/bridge/print", &[
                    "?name=bridge-lan",
                ]).map(|r| !r.is_empty()).unwrap_or(false);

                if !bridge_exists {
                    match mt.query("/interface/bridge/add", &[
                        "=name=bridge-lan",
                        "=comment=LK: LAN bridge",
                    ]) {
                        Ok(_) => {
                            println!("[Setup:LAN] OK: bridge-lan created");
                            steps.push(serde_json::json!({
                                "step": "create_bridge", "status": "ok",
                                "description": "bridge-lan created",
                            }));
                        }
                        Err(e) => {
                            println!("[Setup:LAN] ERROR creating bridge: {}", e);
                            errors.push(format!("Create bridge: {}", e));
                            steps.push(serde_json::json!({
                                "step": "create_bridge", "status": "error", "description": e,
                            }));
                        }
                    }
                } else {
                    println!("[Setup:LAN] bridge-lan already exists");
                    steps.push(serde_json::json!({
                        "step": "create_bridge", "status": "ok",
                        "description": "bridge-lan already exists",
                    }));
                }

                // 2. Add ethernet ports to bridge (all except WAN)
                // Detect WAN: check DHCP clients or default route
                let wan_iface = {
                    let dhcp_clients = mt.query("/ip/dhcp-client/print", &[]).unwrap_or_default();
                    let from_dhcp = dhcp_clients.first().map(|d| jstr(d, "interface")).unwrap_or_default();
                    if !from_dhcp.is_empty() {
                        from_dhcp
                    } else {
                        // Try default route
                        let routes = mt.get_routes().unwrap_or_default();
                        let from_route = routes.iter()
                            .find(|r| jstr(r, "dst-address") == "0.0.0.0/0")
                            .map(|r| jstr(r, "interface"))
                            .unwrap_or_default();
                        if !from_route.is_empty() {
                            from_route
                        } else {
                            // Last fallback: read from DB settings or default ether1
                            let conn_db = rusqlite::Connection::open(&db_path).ok();
                            let from_db = conn_db.as_ref()
                                .map(|c| get_setting(c, "wan_interface"))
                                .unwrap_or_default();
                            if !from_db.is_empty() { from_db } else { "ether1".to_string() }
                        }
                    }
                };
                println!("[Setup:LAN] Detected WAN interface: {}", wan_iface);

                if let Ok(interfaces) = mt.get_interfaces() {
                    let ether_ports: Vec<String> = interfaces.iter()
                        .filter(|i| jstr(i, "type") == "ether" && jstr(i, "name") != wan_iface)
                        .map(|i| jstr(i, "name"))
                        .collect();

                    // Get existing bridge ports
                    let existing_ports: Vec<String> = mt.query("/interface/bridge/port/print", &[
                        "?bridge=bridge-lan",
                    ]).unwrap_or_default().iter()
                        .map(|p| jstr(p, "interface"))
                        .collect();

                    for port in &ether_ports {
                        if existing_ports.contains(port) {
                            println!("[Setup:LAN] {} already in bridge-lan", port);
                            continue;
                        }
                        println!("[Setup:LAN] Adding {} to bridge-lan", port);
                        match mt.query("/interface/bridge/port/add", &[
                            "=bridge=bridge-lan",
                            &format!("=interface={}", port),
                            &format!("=comment=LK: bridge port {}", port),
                        ]) {
                            Ok(_) => {
                                println!("[Setup:LAN] OK: {} added to bridge", port);
                                steps.push(serde_json::json!({
                                    "step": "bridge_port", "status": "ok",
                                    "description": format!("{} added to bridge-lan", port),
                                }));
                            }
                            Err(e) => {
                                println!("[Setup:LAN] ERROR adding {} to bridge: {}", port, e);
                                errors.push(format!("Bridge port {}: {}", port, e));
                            }
                        }
                    }
                }

                // 3. Set management IP on bridge
                // Remove existing LK IPs on bridge-lan
                if let Ok(addrs) = mt.get_ip_addresses() {
                    for addr in &addrs {
                        if jstr(addr, "interface") == "bridge-lan" {
                            let comment = addr.get("comment").and_then(|v| v.as_str()).unwrap_or("");
                            if comment.starts_with("LK:") {
                                if let Some(id) = addr.get(".id").and_then(|v| v.as_str()) {
                                    println!("[Setup:LAN] Removing existing LK IP on bridge-lan");
                                    mt.query("/ip/address/remove", &[&format!("=.id={}", id)]).ok();
                                }
                            }
                        }
                    }
                }

                println!("[Setup:LAN] Setting management IP: {} on bridge-lan", mgmt_address);
                match mt.query("/ip/address/add", &[
                    &format!("=address={}", mgmt_address),
                    "=interface=bridge-lan",
                    "=comment=LK: management IP",
                ]) {
                    Ok(_) => {
                        println!("[Setup:LAN] OK: Management IP set");
                        steps.push(serde_json::json!({
                            "step": "management_ip", "status": "ok",
                            "description": format!("IP {} on bridge-lan", mgmt_address),
                        }));
                    }
                    Err(e) => {
                        println!("[Setup:LAN] ERROR setting IP: {}", e);
                        errors.push(format!("Management IP: {}", e));
                        steps.push(serde_json::json!({
                            "step": "management_ip", "status": "error", "description": e,
                        }));
                    }
                }

                // 4. Create IP pool for PPPoE clients
                // Remove existing LK pool
                if let Ok(pools) = mt.get_ip_pool() {
                    for pool in &pools {
                        if jstr(pool, "name") == "pool-clientes" {
                            if let Some(id) = pool.get(".id").and_then(|v| v.as_str()) {
                                println!("[Setup:LAN] Removing existing pool-clientes");
                                mt.query("/ip/pool/remove", &[&format!("=.id={}", id)]).ok();
                            }
                        }
                    }
                }

                let pool_range = format!("{}-{}", client_pool_start, client_pool_end);
                println!("[Setup:LAN] Creating IP pool: pool-clientes ranges={}", pool_range);
                match mt.query("/ip/pool/add", &[
                    "=name=pool-clientes",
                    &format!("=ranges={}", pool_range),
                    "=comment=LK: client PPPoE pool",
                ]) {
                    Ok(_) => {
                        println!("[Setup:LAN] OK: pool-clientes created");
                        steps.push(serde_json::json!({
                            "step": "ip_pool", "status": "ok",
                            "description": format!("pool-clientes: {}", pool_range),
                        }));
                    }
                    Err(e) => {
                        println!("[Setup:LAN] ERROR creating pool: {}", e);
                        errors.push(format!("IP pool: {}", e));
                        steps.push(serde_json::json!({
                            "step": "ip_pool", "status": "error", "description": e,
                        }));
                    }
                }

                // 5. Add bridge-lan to LAN list
                // Ensure LAN list exists
                if let Ok(lists) = mt.query("/interface/list/print", &["?name=LAN"]) {
                    if lists.is_empty() {
                        mt.query("/interface/list/add", &[
                            "=name=LAN",
                            "=comment=LK: LAN list",
                        ]).ok();
                    }
                }

                // Remove existing LAN list members for bridge-lan
                if let Ok(members) = mt.query("/interface/list/member/print", &["?list=LAN"]) {
                    for m in &members {
                        if jstr(m, "interface") == "bridge-lan" {
                            if let Some(id) = m.get(".id").and_then(|v| v.as_str()) {
                                mt.query("/interface/list/member/remove", &[&format!("=.id={}", id)]).ok();
                            }
                        }
                    }
                }

                println!("[Setup:LAN] Adding bridge-lan to LAN list");
                match mt.query("/interface/list/member/add", &[
                    "=interface=bridge-lan",
                    "=list=LAN",
                    "=comment=LK: LAN member",
                ]) {
                    Ok(_) => {
                        println!("[Setup:LAN] OK: bridge-lan added to LAN list");
                        steps.push(serde_json::json!({
                            "step": "lan_list", "status": "ok",
                            "description": "bridge-lan added to LAN list",
                        }));
                    }
                    Err(e) => {
                        println!("[Setup:LAN] ERROR: LAN list: {}", e);
                        errors.push(format!("LAN list: {}", e));
                    }
                }

                let success = errors.is_empty();
                log_to_db(&db_path, "setup_lan", if success { "OK" } else { "PARTIAL" },
                    &format!("LAN setup: {} steps, {} errors", steps.len(), errors.len()),
                    Some(&serde_json::to_string(&steps).unwrap_or_default()));

                Ok(serde_json::json!({
                    "success": success,
                    "steps": steps,
                    "errors": errors,
                    "bridge": "bridge-lan",
                    "management_ip": mgmt_address,
                    "pool": format!("{}-{}", client_pool_start, client_pool_end),
                }))
            }
            Err(e) => {
                println!("[Setup:LAN] Connection failed: {}", e);
                Ok(serde_json::json!({
                    "success": false,
                    "error": format!("No se pudo conectar: {}", e),
                }))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Parse "192.168.1.0/24" into ("192.168.1.1", "24") — sets .1 as gateway
/// Also accepts "192.168.1.1/24" directly
fn parse_subnet_gateway(subnet: &str) -> (String, String) {
    let parts: Vec<&str> = subnet.split('/').collect();
    let prefix = parts.get(1).unwrap_or(&"24").to_string();
    let ip = parts.first().unwrap_or(&"192.168.1.1");

    // If the IP ends in .0, make it .1 for the gateway
    let octets: Vec<&str> = ip.split('.').collect();
    if octets.len() == 4 && octets[3] == "0" {
        let gateway = format!("{}.{}.{}.1", octets[0], octets[1], octets[2]);
        (gateway, prefix)
    } else {
        (ip.to_string(), prefix)
    }
}

// ---------------------------------------------------------------------------
// 4. setup_pppoe — create PPPoE server and profiles for plans
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn setup_pppoe(
    db: State<'_, Database>,
    plans: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;
        let mut steps: Vec<serde_json::Value> = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        match client.connect() {
            Ok(mut mt) => {
                println!("[Setup:PPPoE] Configuring PPPoE server with {} plans", plans.len());

                // Determine the local address for PPPoE (client subnet gateway)
                // Try to get from existing pool or default to 10.0.0.1
                let local_address = {
                    let pools = mt.get_ip_pool().unwrap_or_default();
                    let client_pool = pools.iter().find(|p| jstr(p, "name") == "pool-clientes");
                    if let Some(pool) = client_pool {
                        let ranges = jstr(pool, "ranges");
                        // Parse "10.0.0.10-10.0.0.250" -> "10.0.0.1"
                        let first_ip = ranges.split('-').next().unwrap_or("10.0.0.10");
                        let octets: Vec<&str> = first_ip.split('.').collect();
                        if octets.len() == 4 {
                            format!("{}.{}.{}.1", octets[0], octets[1], octets[2])
                        } else {
                            "10.0.0.1".to_string()
                        }
                    } else {
                        "10.0.0.1".to_string()
                    }
                };

                // Create PPPoE profiles for each plan
                let mut first_profile = String::new();
                for plan in &plans {
                    let plan_name = jstr(plan, "name");
                    let profile_name = plan.get("profile")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| {
                            // Generate profile name from plan name
                            plan_name.to_lowercase().replace(' ', "-")
                        });
                    let download = plan.get("download").and_then(|v| v.as_i64()).unwrap_or(10);
                    let upload = plan.get("upload").and_then(|v| v.as_i64()).unwrap_or(10);
                    let rate_limit = format!("{}M/{}M", upload, download);

                    if first_profile.is_empty() {
                        first_profile = profile_name.clone();
                    }

                    // Check if profile already exists
                    let exists = mt.query("/ppp/profile/print", &[
                        &format!("?name={}", profile_name),
                    ]).map(|r| !r.is_empty()).unwrap_or(false);

                    if exists {
                        // Update existing profile
                        println!("[Setup:PPPoE] Updating profile: {} ({})", profile_name, rate_limit);
                        if let Ok(profiles) = mt.query("/ppp/profile/print", &[
                            &format!("?name={}", profile_name),
                        ]) {
                            if let Some(p) = profiles.first() {
                                if let Some(id) = p.get(".id").and_then(|v| v.as_str()) {
                                    match mt.query("/ppp/profile/set", &[
                                        &format!("=.id={}", id),
                                        &format!("=rate-limit={}", rate_limit),
                                        &format!("=local-address={}", local_address),
                                        "=remote-address=pool-clientes",
                                        &format!("=comment=LK: {}", plan_name),
                                    ]) {
                                        Ok(_) => {
                                            println!("[Setup:PPPoE] OK: Profile {} updated", profile_name);
                                            steps.push(serde_json::json!({
                                                "step": "profile_update", "status": "ok",
                                                "description": format!("Profile {} updated ({})", profile_name, rate_limit),
                                            }));
                                        }
                                        Err(e) => {
                                            println!("[Setup:PPPoE] ERROR: Profile {}: {}", profile_name, e);
                                            errors.push(format!("Profile {}: {}", profile_name, e));
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        // Create new profile
                        println!("[Setup:PPPoE] Creating profile: {} ({})", profile_name, rate_limit);
                        match mt.query("/ppp/profile/add", &[
                            &format!("=name={}", profile_name),
                            &format!("=rate-limit={}", rate_limit),
                            &format!("=local-address={}", local_address),
                            "=remote-address=pool-clientes",
                            &format!("=comment=LK: {}", plan_name),
                        ]) {
                            Ok(_) => {
                                println!("[Setup:PPPoE] OK: Profile {} created", profile_name);
                                steps.push(serde_json::json!({
                                    "step": "profile_create", "status": "ok",
                                    "description": format!("Profile {} created ({})", profile_name, rate_limit),
                                }));
                            }
                            Err(e) => {
                                println!("[Setup:PPPoE] ERROR: Profile {}: {}", profile_name, e);
                                errors.push(format!("Profile {}: {}", profile_name, e));
                            }
                        }
                    }
                }

                // Create PPPoE server on bridge-lan
                // Remove existing LK PPPoE server
                if let Ok(servers) = mt.query("/interface/pppoe-server/server/print", &[]) {
                    for srv in &servers {
                        let comment = srv.get("comment").and_then(|v| v.as_str()).unwrap_or("");
                        if comment.starts_with("LK:") {
                            if let Some(id) = srv.get(".id").and_then(|v| v.as_str()) {
                                println!("[Setup:PPPoE] Removing existing LK PPPoE server");
                                mt.query("/interface/pppoe-server/server/remove", &[
                                    &format!("=.id={}", id),
                                ]).ok();
                            }
                        }
                    }
                }

                let default_profile = if first_profile.is_empty() {
                    "default".to_string()
                } else {
                    first_profile.clone()
                };

                println!("[Setup:PPPoE] Creating PPPoE server on bridge-lan (default-profile={})", default_profile);
                match mt.query("/interface/pppoe-server/server/add", &[
                    "=service-name=Linker-WISP",
                    "=interface=bridge-lan",
                    &format!("=default-profile={}", default_profile),
                    "=disabled=no",
                    "=comment=LK: PPPoE server",
                ]) {
                    Ok(_) => {
                        println!("[Setup:PPPoE] OK: PPPoE server created");
                        steps.push(serde_json::json!({
                            "step": "pppoe_server", "status": "ok",
                            "description": format!("PPPoE server on bridge-lan (profile={})", default_profile),
                        }));
                    }
                    Err(e) => {
                        println!("[Setup:PPPoE] ERROR: PPPoE server: {}", e);
                        errors.push(format!("PPPoE server: {}", e));
                        steps.push(serde_json::json!({
                            "step": "pppoe_server", "status": "error", "description": e,
                        }));
                    }
                }

                // Save plans to local SQLite
                {
                    let conn = rusqlite::Connection::open(&db_path)
                        .map_err(|e| format!("DB error: {}", e))?;
                    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

                    for plan in &plans {
                        let plan_name = jstr(plan, "name");
                        let profile_name = plan.get("profile")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| plan_name.to_lowercase().replace(' ', "-"));
                        let download = plan.get("download").and_then(|v| v.as_i64()).unwrap_or(10);
                        let upload = plan.get("upload").and_then(|v| v.as_i64()).unwrap_or(10);
                        let price = plan.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let id = gen_id();

                        // Upsert: insert or update by profile_name
                        match conn.execute(
                            "INSERT INTO plans (id, name, download_mbps, upload_mbps, price, profile_name)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                             ON CONFLICT(profile_name) DO UPDATE SET
                                name=excluded.name,
                                download_mbps=excluded.download_mbps,
                                upload_mbps=excluded.upload_mbps,
                                price=excluded.price",
                            rusqlite::params![id, plan_name, download, upload, price, profile_name],
                        ) {
                            Ok(_) => {
                                println!("[Setup:PPPoE] Plan saved to DB: {}", plan_name);
                            }
                            Err(e) => {
                                println!("[Setup:PPPoE] ERROR saving plan to DB: {}", e);
                                errors.push(format!("DB plan {}: {}", plan_name, e));
                            }
                        }
                    }
                    drop(conn);
                }

                let success = errors.is_empty();
                log_to_db(&db_path, "setup_pppoe", if success { "OK" } else { "PARTIAL" },
                    &format!("PPPoE setup: {} plans, {} errors", plans.len(), errors.len()),
                    Some(&serde_json::to_string(&steps).unwrap_or_default()));

                Ok(serde_json::json!({
                    "success": success,
                    "steps": steps,
                    "errors": errors,
                    "profiles_created": plans.len(),
                }))
            }
            Err(e) => {
                println!("[Setup:PPPoE] Connection failed: {}", e);
                Ok(serde_json::json!({
                    "success": false,
                    "error": format!("No se pudo conectar: {}", e),
                }))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// 5. setup_security — NAT, firewall, DNS, isolation, anti-DDoS
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn setup_security(
    db: State<'_, Database>,
    total_bandwidth_down: i64,
    total_bandwidth_up: i64,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let client = make_client(&db_path)?;
        let mut steps: Vec<serde_json::Value> = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        match client.connect() {
            Ok(mut mt) => {
                println!("[Setup:Security] Applying security config (BW: {}M/{}M)",
                    total_bandwidth_down, total_bandwidth_up);

                // === 1. NAT Masquerade ===
                setup_nat_masquerade(&mut mt, &mut steps, &mut errors);

                // === 2. Firewall rules ===
                setup_firewall(&mut mt, &mut steps, &mut errors);

                // === 3. DNS cache ===
                setup_dns(&mut mt, &mut steps, &mut errors);

                // === 4. Client isolation ===
                setup_client_isolation(&mut mt, &mut steps, &mut errors);

                // === 5. Anti-DDoS basics ===
                setup_anti_ddos(&mut mt, &mut steps, &mut errors);

                // === 6. Global bandwidth limit (optional) ===
                if total_bandwidth_down > 0 && total_bandwidth_up > 0 {
                    setup_bandwidth_limit(&mut mt, total_bandwidth_down, total_bandwidth_up,
                        &mut steps, &mut errors);
                }

                let success = errors.is_empty();
                log_to_db(&db_path, "setup_security", if success { "OK" } else { "PARTIAL" },
                    &format!("Security setup: {} steps, {} errors", steps.len(), errors.len()),
                    Some(&serde_json::to_string(&steps).unwrap_or_default()));

                Ok(serde_json::json!({
                    "success": success,
                    "steps": steps,
                    "errors": errors,
                }))
            }
            Err(e) => {
                println!("[Setup:Security] Connection failed: {}", e);
                Ok(serde_json::json!({
                    "success": false,
                    "error": format!("No se pudo conectar: {}", e),
                }))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn setup_nat_masquerade(
    mt: &mut MikroTikConnection,
    steps: &mut Vec<serde_json::Value>,
    errors: &mut Vec<String>,
) {
    println!("[Setup:Security] Configuring NAT masquerade...");

    // Remove existing LK NAT rules
    if let Ok(nat_rules) = mt.get_firewall_nat() {
        for rule in &nat_rules {
            let comment = rule.get("comment").and_then(|v| v.as_str()).unwrap_or("");
            if comment.starts_with("LK:") {
                if let Some(id) = rule.get(".id").and_then(|v| v.as_str()) {
                    println!("[Setup:Security] Removing existing LK NAT rule: {}", id);
                    mt.query("/ip/firewall/nat/remove", &[&format!("=.id={}", id)]).ok();
                }
            }
        }
    }

    // Add NAT masquerade on WAN
    match mt.query("/ip/firewall/nat/add", &[
        "=chain=srcnat",
        "=out-interface-list=WAN",
        "=action=masquerade",
        "=comment=LK: NAT masquerade",
    ]) {
        Ok(_) => {
            println!("[Setup:Security] OK: NAT masquerade applied");
            steps.push(serde_json::json!({
                "step": "nat_masquerade", "status": "ok",
                "description": "NAT masquerade on WAN",
            }));
        }
        Err(e) => {
            println!("[Setup:Security] ERROR: NAT masquerade: {}", e);
            errors.push(format!("NAT masquerade: {}", e));
            steps.push(serde_json::json!({
                "step": "nat_masquerade", "status": "error", "description": e,
            }));
        }
    }
}

fn setup_firewall(
    mt: &mut MikroTikConnection,
    steps: &mut Vec<serde_json::Value>,
    errors: &mut Vec<String>,
) {
    println!("[Setup:Security] Configuring firewall rules...");

    // Detect REAL subnets from MikroTik — never hardcode
    let subnets = detect_subnets(mt);

    // Remove existing LK firewall rules
    remove_lk_firewall_rules(mt, "firewall", errors);

    // Build rules dynamically based on detected subnets
    let mut rules: Vec<(String, Vec<String>)> = vec![
        // INPUT chain
        ("INPUT: Accept established/related/untracked".into(), vec![
            "=chain=input".into(),
            "=action=accept".into(),
            "=connection-state=established,related,untracked".into(),
            "=comment=LK: firewall input accept-established".into(),
        ]),
        ("INPUT: Drop invalid".into(), vec![
            "=chain=input".into(),
            "=action=drop".into(),
            "=connection-state=invalid".into(),
            "=comment=LK: firewall input drop-invalid".into(),
        ]),
        ("INPUT: Accept ICMP (rate limited)".into(), vec![
            "=chain=input".into(),
            "=action=accept".into(),
            "=protocol=icmp".into(),
            "=limit=10,20:packet".into(),
            "=comment=LK: firewall input accept-icmp-limited".into(),
        ]),
        ("INPUT: Accept from LAN".into(), vec![
            "=chain=input".into(),
            "=action=accept".into(),
            "=in-interface-list=LAN".into(),
            "=comment=LK: firewall input accept-lan".into(),
        ]),
        ("INPUT: Accept WireGuard".into(), vec![
            "=chain=input".into(),
            "=action=accept".into(),
            "=protocol=udp".into(),
            "=dst-port=13231".into(),
            "=comment=LK: firewall input accept-wireguard".into(),
        ]),
    ];

    // Only add VPN API rule if VPN subnet detected
    if !subnets.vpn_subnet.is_empty() {
        rules.push(("INPUT: Accept API from VPN".into(), vec![
            "=chain=input".into(),
            "=action=accept".into(),
            "=protocol=tcp".into(),
            "=dst-port=8728".into(),
            format!("=src-address={}", subnets.vpn_subnet),
            "=comment=LK: firewall input accept-api-vpn".into(),
        ]));
    }

    rules.push(("INPUT: Drop everything else".into(), vec![
        "=chain=input".into(),
        "=action=drop".into(),
        "=comment=LK: firewall input drop-all".into(),
    ]));

    // FORWARD chain
    rules.extend(vec![
        ("FORWARD: Accept established/related/untracked".into(), vec![
            "=chain=forward".into(),
            "=action=accept".into(),
            "=connection-state=established,related,untracked".into(),
            "=comment=LK: firewall forward accept-established".into(),
        ]),
        ("FORWARD: Drop invalid".into(), vec![
            "=chain=forward".into(),
            "=action=drop".into(),
            "=connection-state=invalid".into(),
            "=comment=LK: firewall forward drop-invalid".into(),
        ]),
        ("FORWARD: Fasttrack established/related".into(), vec![
            "=chain=forward".into(),
            "=action=fasttrack-connection".into(),
            "=connection-state=established,related".into(),
            "=comment=LK: firewall forward fasttrack".into(),
        ]),
        ("FORWARD: Accept LAN to WAN".into(), vec![
            "=chain=forward".into(),
            "=action=accept".into(),
            "=in-interface-list=LAN".into(),
            "=out-interface-list=WAN".into(),
            "=comment=LK: firewall forward accept-lan-wan".into(),
        ]),
    ]);

    // Only add client isolation rules if client subnet is known
    if !subnets.client_subnet.is_empty() {
        rules.push(("FORWARD: Drop client-to-client".into(), vec![
            "=chain=forward".into(),
            "=action=drop".into(),
            format!("=src-address={}", subnets.client_subnet),
            format!("=dst-address={}", subnets.client_subnet),
            "=comment=LK: firewall forward drop-client-to-client".into(),
        ]));

        // Only add client-to-mgmt rule if management subnet is also known
        if !subnets.management_subnet.is_empty() {
            rules.push(("FORWARD: Drop clients to management".into(), vec![
                "=chain=forward".into(),
                "=action=drop".into(),
                format!("=src-address={}", subnets.client_subnet),
                format!("=dst-address={}", subnets.management_subnet),
                "=comment=LK: firewall forward drop-client-to-mgmt".into(),
            ]));
        }
    }

    // Only add VPN forward rule if VPN subnet detected
    if !subnets.vpn_subnet.is_empty() {
        rules.push(("FORWARD: Accept VPN to LAN".into(), vec![
            "=chain=forward".into(),
            "=action=accept".into(),
            format!("=src-address={}", subnets.vpn_subnet),
            "=comment=LK: firewall forward accept-vpn-lan".into(),
        ]));
    }

    for (desc, args) in &rules {
        println!("[Setup:Security] Firewall: {}", desc);
        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_firewall_filter(&args_ref) {
            Ok(_) => {
                println!("[Setup:Security] OK: {}", desc);
                steps.push(serde_json::json!({
                    "step": "firewall", "status": "ok", "description": desc,
                }));
            }
            Err(e) => {
                println!("[Setup:Security] ERROR: {}: {}", desc, e);
                errors.push(format!("{}: {}", desc, e));
            }
        }
    }
}

fn setup_dns(
    mt: &mut MikroTikConnection,
    steps: &mut Vec<serde_json::Value>,
    errors: &mut Vec<String>,
) {
    println!("[Setup:Security] Configuring DNS cache...");
    match mt.query("/ip/dns/set", &[
        "=servers=8.8.8.8,1.1.1.1",
        "=allow-remote-requests=yes",
        "=cache-size=4096",
    ]) {
        Ok(_) => {
            println!("[Setup:Security] OK: DNS configured");
            steps.push(serde_json::json!({
                "step": "dns", "status": "ok",
                "description": "DNS: 8.8.8.8, 1.1.1.1 | cache: 4096KiB | remote: yes",
            }));
        }
        Err(e) => {
            println!("[Setup:Security] ERROR: DNS: {}", e);
            errors.push(format!("DNS: {}", e));
        }
    }
}

fn setup_client_isolation(
    mt: &mut MikroTikConnection,
    steps: &mut Vec<serde_json::Value>,
    errors: &mut Vec<String>,
) {
    println!("[Setup:Security] Configuring client isolation...");

    // Detect REAL subnets — never hardcode
    let subnets = detect_subnets(mt);

    // Remove existing isolation rules
    remove_lk_firewall_rules(mt, "isolation", errors);

    if subnets.client_subnet.is_empty() {
        println!("[Setup:Security] No client subnet detected, skipping isolation rules");
        steps.push(serde_json::json!({
            "step": "isolation", "status": "skipped",
            "description": "No se detecto subred de clientes, se omitio aislamiento",
        }));
        return;
    }

    let mut rules: Vec<(String, Vec<String>)> = vec![
        ("Drop PPPoE inter-client traffic".into(), vec![
            "=chain=forward".into(),
            "=action=drop".into(),
            format!("=src-address={}", subnets.client_subnet),
            format!("=dst-address={}", subnets.client_subnet),
            "=comment=LK: isolation drop-inter-client".into(),
        ]),
    ];

    if !subnets.management_subnet.is_empty() {
        rules.push(("Drop PPPoE clients to management network".into(), vec![
            "=chain=forward".into(),
            "=action=drop".into(),
            format!("=src-address={}", subnets.client_subnet),
            format!("=dst-address={}", subnets.management_subnet),
            "=comment=LK: isolation drop-client-to-mgmt".into(),
        ]));
    }

    for (desc, args) in &rules {
        println!("[Setup:Security] Isolation: {}", desc);
        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_firewall_filter(&args_ref) {
            Ok(_) => {
                println!("[Setup:Security] OK: {}", desc);
                steps.push(serde_json::json!({
                    "step": "isolation", "status": "ok", "description": desc,
                }));
            }
            Err(e) => {
                println!("[Setup:Security] ERROR: {}: {}", desc, e);
                errors.push(format!("{}: {}", desc, e));
            }
        }
    }
}

fn setup_anti_ddos(
    mt: &mut MikroTikConnection,
    steps: &mut Vec<serde_json::Value>,
    errors: &mut Vec<String>,
) {
    println!("[Setup:Security] Configuring anti-DDoS...");

    // Detect REAL subnets — never hardcode
    let subnets = detect_subnets(mt);

    remove_lk_firewall_rules(mt, "antiddos", errors);

    let mut rules: Vec<(String, Vec<String>)> = vec![
        ("SYN flood protection".into(), vec![
            "=chain=input".into(),
            "=action=drop".into(),
            "=protocol=tcp".into(),
            "=tcp-flags=syn".into(),
            "=connection-limit=100,32".into(),
            "=comment=LK: antiddos syn-flood-drop".into(),
        ]),
        ("Accept ICMP (rate limited)".into(), vec![
            "=chain=input".into(),
            "=action=accept".into(),
            "=protocol=icmp".into(),
            "=limit=10,20:packet".into(),
            "=comment=LK: antiddos icmp-accept-limited".into(),
        ]),
        ("Drop excess ICMP".into(), vec![
            "=chain=input".into(),
            "=action=drop".into(),
            "=protocol=icmp".into(),
            "=comment=LK: antiddos icmp-drop-excess".into(),
        ]),
    ];

    // Only add per-client connection limit if client subnet is known
    if !subnets.client_subnet.is_empty() {
        rules.push(("Connection limit per client".into(), vec![
            "=chain=forward".into(),
            "=action=drop".into(),
            "=protocol=tcp".into(),
            format!("=src-address={}", subnets.client_subnet),
            "=connection-limit=200,32".into(),
            "=comment=LK: antiddos conn-limit-per-client".into(),
        ]));
    }

    for (desc, args) in &rules {
        println!("[Setup:Security] AntiDDoS: {}", desc);
        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match mt.add_firewall_filter(&args_ref) {
            Ok(_) => {
                println!("[Setup:Security] OK: {}", desc);
                steps.push(serde_json::json!({
                    "step": "antiddos", "status": "ok", "description": desc,
                }));
            }
            Err(e) => {
                println!("[Setup:Security] ERROR: {}: {}", desc, e);
                errors.push(format!("{}: {}", desc, e));
            }
        }
    }
}

fn setup_bandwidth_limit(
    mt: &mut MikroTikConnection,
    total_down: i64,
    total_up: i64,
    steps: &mut Vec<serde_json::Value>,
    errors: &mut Vec<String>,
) {
    println!("[Setup:Security] Setting global bandwidth limit: {}M/{}M", total_down, total_up);

    // Remove existing LK queues
    if let Ok(queues) = mt.query("/queue/simple/print", &[]) {
        for q in &queues {
            let comment = q.get("comment").and_then(|v| v.as_str()).unwrap_or("");
            if comment.starts_with("LK:") {
                if let Some(id) = q.get(".id").and_then(|v| v.as_str()) {
                    mt.query("/queue/simple/remove", &[&format!("=.id={}", id)]).ok();
                }
            }
        }
    }

    // Remove existing LK queue types
    if let Ok(types) = mt.query("/queue/type/print", &[]) {
        for t in &types {
            let comment = t.get("comment").and_then(|v| v.as_str()).unwrap_or("");
            if comment.starts_with("LK:") {
                if let Some(id) = t.get(".id").and_then(|v| v.as_str()) {
                    mt.query("/queue/type/remove", &[&format!("=.id={}", id)]).ok();
                }
            }
        }
    }

    // Create PCQ types for fair distribution
    let pcq_types = vec![
        ("LK-pcq-download", "pcq", "dst-address"),
        ("LK-pcq-upload", "pcq", "src-address"),
    ];

    for (name, kind, classifier) in &pcq_types {
        match mt.query("/queue/type/add", &[
            &format!("=name={}", name),
            &format!("=kind={}", kind),
            "=pcq-rate=0",
            &format!("=pcq-classifier={}", classifier),
            &format!("=comment=LK: qos {}", name),
        ]) {
            Ok(_) => {
                println!("[Setup:Security] OK: Queue type {}", name);
                steps.push(serde_json::json!({
                    "step": "qos_type", "status": "ok",
                    "description": format!("Queue type {} created", name),
                }));
            }
            Err(e) => {
                println!("[Setup:Security] ERROR: Queue type {}: {}", name, e);
                errors.push(format!("Queue type {}: {}", name, e));
            }
        }
    }

    // Create global bandwidth queue — detect client subnet from MikroTik
    let subnets = detect_subnets(mt);
    let queue_target = if !subnets.client_subnet.is_empty() {
        subnets.client_subnet.clone()
    } else {
        // Fallback: use pool range if available
        "0.0.0.0/0".to_string()
    };
    println!("[Setup:Security] QoS target subnet: {}", queue_target);

    let max_limit = format!("{}M/{}M", total_up, total_down);
    let target_arg = format!("=target={}", queue_target);
    match mt.query("/queue/simple/add", &[
        "=name=LK-global-queue",
        &target_arg,
        &format!("=max-limit={}", max_limit),
        "=queue=LK-pcq-upload/LK-pcq-download",
        "=comment=LK: qos global-queue",
    ]) {
        Ok(_) => {
            println!("[Setup:Security] OK: Global queue ({})", max_limit);
            steps.push(serde_json::json!({
                "step": "qos_queue", "status": "ok",
                "description": format!("Global queue: {}", max_limit),
            }));
        }
        Err(e) => {
            println!("[Setup:Security] ERROR: Global queue: {}", e);
            errors.push(format!("Global queue: {}", e));
        }
    }
}

/// Remove LK firewall filter rules matching a module prefix
fn remove_lk_firewall_rules(mt: &mut MikroTikConnection, module: &str, errors: &mut Vec<String>) {
    let prefix = format!("LK: {}", module);
    println!("[Setup:Security] Removing existing '{}' rules...", prefix);
    match mt.get_firewall_filter() {
        Ok(rules) => {
            let ids: Vec<String> = rules.iter()
                .filter(|r| {
                    r.get("comment").and_then(|v| v.as_str()).unwrap_or("").starts_with(&prefix)
                })
                .filter_map(|r| r.get(".id").and_then(|v| v.as_str()).map(|s| s.to_string()))
                .collect();
            for id in ids.iter().rev() {
                if let Err(e) = mt.remove_firewall_filter(id) {
                    errors.push(format!("Remove rule {}: {}", id, e));
                }
            }
        }
        Err(e) => errors.push(format!("Read rules: {}", e)),
    }
}

// ---------------------------------------------------------------------------
// 6. get_ip_map — management subnet IP usage map (v2)
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn get_ip_map(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        use std::collections::HashMap;

        // ── 1. Read nodes from DB ──
        let db_nodes: Vec<serde_json::Value> = {
            let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();
            let mut stmt = conn.prepare(
                "SELECT id, name, type, ip, mac, status FROM nodes WHERE ip IS NOT NULL"
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "node_type": row.get::<_, String>(2)?,
                    "ip": row.get::<_, String>(3)?,
                    "mac": row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    "status": row.get::<_, String>(5)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
            rows
        };

        // Index DB nodes by IP for fast lookup
        let mut db_by_ip: HashMap<String, &serde_json::Value> = HashMap::new();
        for node in &db_nodes {
            if let Some(ip) = node.get("ip").and_then(|v| v.as_str()) {
                db_by_ip.insert(ip.to_string(), node);
            }
        }

        // Helper: extract /24 prefix from an IP string
        let ip_prefix = |ip: &str| -> String {
            let octets: Vec<&str> = ip.split('.').collect();
            if octets.len() >= 3 {
                format!("{}.{}.{}.", octets[0], octets[1], octets[2])
            } else {
                String::new()
            }
        };

        let client = make_client(&db_path)?;

        match client.connect() {
            Ok(mut mt) => {
                println!("[IPMap] Connected to MikroTik, reading data...");

                // ── 2. Read ALL IP addresses on ALL interfaces ──
                let addresses = mt.get_ip_addresses().unwrap_or_default();
                println!("[IPMap] Found {} IP addresses on router", addresses.len());

                // ── 3. Read ARP table ──
                let arp_entries = mt.get_arp_table().unwrap_or_default();
                println!("[IPMap] Found {} ARP entries", arp_entries.len());

                // ── 4. Read DHCP leases ──
                let dhcp_leases = mt.get_dhcp_leases().unwrap_or_default();
                println!("[IPMap] Found {} DHCP leases", dhcp_leases.len());

                // Index ARP by IP
                let mut arp_by_ip: HashMap<String, &serde_json::Value> = HashMap::new();
                for entry in &arp_entries {
                    let ip = jstr(entry, "address");
                    if !ip.is_empty() {
                        arp_by_ip.insert(ip, entry);
                    }
                }

                // Index DHCP by IP
                let mut dhcp_by_ip: HashMap<String, &serde_json::Value> = HashMap::new();
                for lease in &dhcp_leases {
                    let ip = jstr(lease, "address");
                    if !ip.is_empty() {
                        dhcp_by_ip.insert(ip, lease);
                    }
                }

                // ── 5. Build subnets list from router addresses ──
                let node_ips: Vec<String> = db_nodes.iter()
                    .filter_map(|n| n.get("ip").and_then(|v| v.as_str()).map(|s| s.to_string()))
                    .collect();

                let mut subnets: Vec<serde_json::Value> = Vec::new();
                let mut subnet_node_counts: Vec<(String, String, String, usize)> = Vec::new(); // (network, gateway, interface, count)

                for addr_val in &addresses {
                    let full_addr = jstr(addr_val, "address"); // e.g. "192.168.1.1/24"
                    let iface = jstr(addr_val, "interface");
                    let parts: Vec<&str> = full_addr.split('/').collect();
                    let gw_ip = parts.first().unwrap_or(&"0.0.0.0").to_string();
                    let cidr = parts.get(1).unwrap_or(&"24").to_string();
                    let octets: Vec<&str> = gw_ip.split('.').collect();
                    if octets.len() != 4 { continue; }
                    let network = format!("{}.{}.{}.0/{}", octets[0], octets[1], octets[2], cidr);
                    let prefix = format!("{}.{}.{}.", octets[0], octets[1], octets[2]);

                    // Count how many DB nodes are in this subnet
                    let count = node_ips.iter().filter(|ip| ip.starts_with(&prefix)).count();
                    subnet_node_counts.push((network.clone(), gw_ip.clone(), iface.clone(), count));
                }

                // ── 6. Detect primary subnet ──
                // Primary = subnet with the most DB nodes. If tie, prefer non-88.x subnet.
                subnet_node_counts.sort_by(|a, b| {
                    b.3.cmp(&a.3).then_with(|| {
                        let a_is_88 = a.0.starts_with("192.168.88.");
                        let b_is_88 = b.0.starts_with("192.168.88.");
                        a_is_88.cmp(&b_is_88)
                    })
                });

                let primary = subnet_node_counts.first().cloned()
                    .unwrap_or(("192.168.1.0/24".to_string(), "192.168.1.1".to_string(), "bridge".to_string(), 0));

                for (network, gw_ip, iface, _count) in &subnet_node_counts {
                    subnets.push(serde_json::json!({
                        "network": network,
                        "gateway": gw_ip,
                        "interface": iface,
                        "is_primary": network == &primary.0,
                    }));
                }

                let primary_subnet = primary.0.clone();
                let primary_gateway = primary.1.clone();
                let primary_prefix = ip_prefix(&primary_gateway);

                // ── 7. Build merged used-IPs list (ALL subnets) ──
                let mut used: Vec<serde_json::Value> = Vec::new();
                let mut used_ip_set: std::collections::HashSet<String> = std::collections::HashSet::new();

                // Collect ALL gateway IPs
                let gateway_ips: std::collections::HashSet<String> = subnet_node_counts.iter()
                    .map(|(_, gw, _, _)| gw.clone())
                    .collect();

                // First pass: iterate all unique IPs from ARP + DHCP + DB
                let mut all_ips: std::collections::HashSet<String> = std::collections::HashSet::new();
                for ip in arp_by_ip.keys() { all_ips.insert(ip.clone()); }
                for ip in dhcp_by_ip.keys() { all_ips.insert(ip.clone()); }
                for ip in db_by_ip.keys() { all_ips.insert(ip.clone()); }
                for ip in &gateway_ips { all_ips.insert(ip.clone()); }

                for ip in &all_ips {
                    let in_arp = arp_by_ip.contains_key(ip.as_str());
                    let in_dhcp = dhcp_by_ip.contains_key(ip.as_str());
                    let in_db = db_by_ip.contains_key(ip.as_str());
                    let is_gateway = gateway_ips.contains(ip);

                    // Determine type and name
                    let (entry_type, name, source) = if is_gateway {
                        ("gateway".to_string(), "MikroTik Router".to_string(), "router".to_string())
                    } else if in_db && in_arp {
                        let db_name = db_by_ip[ip].get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        ("node".to_string(), db_name, "arp+db".to_string())
                    } else if in_db && !in_arp {
                        let db_name = db_by_ip[ip].get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        ("node_offline".to_string(), db_name, "db".to_string())
                    } else if in_dhcp {
                        let hostname = jstr(dhcp_by_ip[ip], "host-name");
                        let lease_name = if hostname.is_empty() {
                            format!("DHCP-{}", ip.split('.').last().unwrap_or("?"))
                        } else {
                            hostname
                        };
                        ("dhcp".to_string(), lease_name, "dhcp".to_string())
                    } else if in_arp {
                        ("unknown".to_string(), format!("Desconocido ({})", ip.split('.').last().unwrap_or("?")), "arp".to_string())
                    } else {
                        continue; // should not happen
                    };

                    // Get MAC: prefer ARP (real), then DHCP, then DB
                    let mac = if let Some(arp) = arp_by_ip.get(ip.as_str()) {
                        jstr(arp, "mac-address")
                    } else if let Some(dhcp) = dhcp_by_ip.get(ip.as_str()) {
                        jstr(dhcp, "mac-address")
                    } else if let Some(db_node) = db_by_ip.get(ip.as_str()) {
                        jstr(db_node, "mac")
                    } else {
                        String::new()
                    };

                    // Get interface from ARP if available
                    let iface = if let Some(arp) = arp_by_ip.get(ip.as_str()) {
                        jstr(arp, "interface")
                    } else {
                        String::new()
                    };

                    let mut entry = serde_json::json!({
                        "ip": ip,
                        "type": entry_type,
                        "name": name,
                        "source": source,
                    });

                    if !mac.is_empty() {
                        entry["mac"] = serde_json::Value::String(mac);
                    }
                    if !iface.is_empty() {
                        entry["interface"] = serde_json::Value::String(iface);
                    }

                    // For DB nodes, include node_id for linking
                    if in_db {
                        if let Some(db_node) = db_by_ip.get(ip.as_str()) {
                            if let Some(id) = db_node.get("id").and_then(|v| v.as_str()) {
                                entry["node_id"] = serde_json::Value::String(id.to_string());
                            }
                        }
                    }

                    // DHCP status
                    if in_dhcp {
                        if let Some(dhcp) = dhcp_by_ip.get(ip.as_str()) {
                            let status = jstr(dhcp, "status");
                            if !status.is_empty() {
                                entry["dhcp_status"] = serde_json::Value::String(status);
                            }
                        }
                    }

                    used.push(entry);
                    used_ip_set.insert(ip.clone());
                }

                // Sort used by IP numeric order
                used.sort_by(|a, b| {
                    let ip_a = jstr(a, "ip");
                    let ip_b = jstr(b, "ip");
                    let parse_ip = |ip: &str| -> u32 {
                        ip.split('.').enumerate().fold(0u32, |acc, (i, part)| {
                            acc + (part.parse::<u32>().unwrap_or(0) << (8 * (3 - i)))
                        })
                    };
                    parse_ip(&ip_a).cmp(&parse_ip(&ip_b))
                });

                // ── Calculate next available in primary subnet ──
                let mut next_available = String::new();
                for last_octet in 2..255u8 {
                    let ip = format!("{}{}", primary_prefix, last_octet);
                    if !used_ip_set.contains(&ip) {
                        if next_available.is_empty() {
                            next_available = ip;
                        }
                    }
                }

                let total_used = used.iter()
                    .filter(|e| jstr(e, "ip").starts_with(&primary_prefix))
                    .count();
                let total_free = 254usize.saturating_sub(total_used); // .1 to .254 minus used

                // ── Debug output ──
                println!("[IPMap] ═══════════════════════════════════════");
                println!("[IPMap] Primary subnet: {} (gateway: {})", primary_subnet, primary_gateway);
                println!("[IPMap] Total used IPs: {} (all subnets: {})", total_used, used.len());
                println!("[IPMap] Total free: {}, Next available: {}", total_free, next_available);
                for entry in &used {
                    let ip = jstr(entry, "ip");
                    let entry_type = jstr(entry, "type");
                    let name = jstr(entry, "name");
                    let mac = jstr(entry, "mac");
                    let source = jstr(entry, "source");
                    println!("[IPMap]   {} | {:12} | {:20} | {:17} | {}", ip, entry_type, name, mac, source);
                }
                println!("[IPMap] ═══════════════════════════════════════");

                Ok(serde_json::json!({
                    "connected": true,
                    "subnets": subnets,
                    "primary_subnet": primary_subnet,
                    "primary_gateway": primary_gateway,
                    "primary_prefix": primary_prefix,
                    "used": used,
                    "next_available": next_available,
                    "total_used": total_used,
                    "total_free": total_free,
                }))
            }
            Err(e) => {
                println!("[IPMap] Connection failed: {}, returning DB-only data", e);

                // Build used list from DB nodes only
                let mut used: Vec<serde_json::Value> = Vec::new();
                for node in &db_nodes {
                    let ip = jstr(node, "ip");
                    let name = jstr(node, "name");
                    let mac = jstr(node, "mac");
                    let mut entry = serde_json::json!({
                        "ip": ip,
                        "type": "node_offline",
                        "name": name,
                        "source": "db",
                    });
                    if !mac.is_empty() {
                        entry["mac"] = serde_json::Value::String(mac);
                    }
                    if let Some(id) = node.get("id").and_then(|v| v.as_str()) {
                        entry["node_id"] = serde_json::Value::String(id.to_string());
                    }
                    used.push(entry);
                }

                // Try to detect subnet from DB IPs
                let mut prefix_counts: HashMap<String, usize> = HashMap::new();
                for node in &db_nodes {
                    let ip = jstr(node, "ip");
                    let prefix = ip_prefix(&ip);
                    if !prefix.is_empty() {
                        *prefix_counts.entry(prefix).or_insert(0) += 1;
                    }
                }
                let best_prefix = prefix_counts.into_iter()
                    .max_by_key(|(_, count)| *count)
                    .map(|(prefix, _)| prefix)
                    .unwrap_or("192.168.1.".to_string());
                let primary_subnet = format!("{}0/24", best_prefix);
                let primary_gateway = format!("{}1", best_prefix);

                Ok(serde_json::json!({
                    "connected": false,
                    "error": format!("No se pudo conectar al MikroTik: {}", e),
                    "subnets": [{
                        "network": primary_subnet.clone(),
                        "gateway": primary_gateway.clone(),
                        "interface": "unknown",
                        "is_primary": true,
                    }],
                    "primary_subnet": primary_subnet,
                    "primary_gateway": primary_gateway,
                    "primary_prefix": best_prefix,
                    "used": used,
                    "next_available": "",
                    "total_used": used.len(),
                    "total_free": 0,
                }))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// 7. add_antenna — add an antenna/CPE to the network
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn add_antenna(
    db: State<'_, Database>,
    name: String,
    ip: String,
    antenna_type: String,
    parent_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        // 1. Create node in DB (with duplicate checks)
        let node_id = gen_id();
        {
            let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();

            // Check for duplicate IP
            if !ip.is_empty() {
                let dup_ip: bool = conn.query_row(
                    "SELECT COUNT(*) > 0 FROM nodes WHERE ip = ?1", [&ip], |r| r.get(0)
                ).unwrap_or(false);
                if dup_ip {
                    return Err(format!("Ya existe un nodo con la IP {}", ip));
                }
            }

            conn.execute(
                "INSERT INTO nodes (id, name, type, ip, parent_id, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'UNKNOWN')",
                rusqlite::params![node_id, name, antenna_type, ip, parent_id],
            ).map_err(|e| format!("Error creando antena: {}", e))?;
            drop(conn);
        }

        println!("[Setup:Antenna] Node created: {} ({}) at {}", name, antenna_type, ip);

        // 2. Connect to MikroTik and ping
        let client = make_client(&db_path)?;
        let (reachable, ssh_info) = match client.connect() {
            Ok(mut mt) => {
                println!("[Setup:Antenna] Pinging {}...", ip);
                let is_reachable = mt.ping_address(&ip).unwrap_or(false);
                println!("[Setup:Antenna] Ping result: {}", if is_reachable { "OK" } else { "UNREACHABLE" });

                let mut info = serde_json::json!({});

                // If reachable, try SSH to get device info
                if is_reachable {
                    println!("[Setup:Antenna] Trying SSH to {}...", ip);
                    // Read credentials from DB settings, with fallback defaults
                    let creds = get_ssh_credentials(&db_path);
                    let ssh_attempts: Vec<(&str, &str)> = creds.iter()
                        .map(|(u, p)| (u.as_str(), p.as_str()))
                        .collect();

                    for (user, pass) in ssh_attempts {
                        match mt.ssh_exec(&ip, user, pass, "cat /etc/version 2>/dev/null || /system/identity/print") {
                            Ok((output, exit_code)) => {
                                if exit_code == 0 && !output.is_empty() {
                                    println!("[Setup:Antenna] SSH success (user={}): {}", user, output.trim());
                                    info = serde_json::json!({
                                        "ssh_user": user,
                                        "firmware": output.trim(),
                                    });

                                    // Try to get model
                                    if let Ok((model_out, _)) = mt.ssh_exec(&ip, user, pass,
                                        "cat /etc/board.info 2>/dev/null | grep board.name || echo unknown"
                                    ) {
                                        let model = model_out.trim().replace("board.name=", "");
                                        if !model.is_empty() && model != "unknown" {
                                            info["model"] = serde_json::Value::String(model.to_string());
                                        }
                                    }

                                    // Try hostname
                                    if let Ok((hostname_out, _)) = mt.ssh_exec(&ip, user, pass, "hostname") {
                                        let hostname = hostname_out.trim();
                                        if !hostname.is_empty() {
                                            info["hostname"] = serde_json::Value::String(hostname.to_string());
                                        }
                                    }

                                    break;
                                }
                            }
                            Err(e) => {
                                println!("[Setup:Antenna] SSH attempt (user={}) failed: {}", user, e);
                            }
                        }
                    }
                }

                (is_reachable, info)
            }
            Err(e) => {
                println!("[Setup:Antenna] MikroTik connection failed (ping skipped): {}", e);
                (false, serde_json::json!({"error": e}))
            }
        };

        // 3. Update node status in DB based on ping
        let status = if reachable { "ONLINE" } else { "OFFLINE" };
        let model = ssh_info.get("model").and_then(|v| v.as_str()).map(|s| s.to_string());
        let firmware = ssh_info.get("firmware").and_then(|v| v.as_str()).map(|s| s.to_string());

        {
            let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();
            conn.execute(
                "UPDATE nodes SET status=?2, model=COALESCE(?3, model), firmware=COALESCE(?4, firmware),
                 last_seen=CASE WHEN ?2='ONLINE' THEN datetime('now') ELSE last_seen END,
                 updated_at=datetime('now')
                 WHERE id=?1",
                rusqlite::params![node_id, status, model, firmware],
            ).ok();
            drop(conn);
        }

        log_to_db(&db_path, "add_antenna", "OK",
            &format!("Antenna added: {} ({}) at {} - {}", name, antenna_type, ip, status), None);

        Ok(serde_json::json!({
            "success": true,
            "node": {
                "id": node_id,
                "name": name,
                "type": antenna_type,
                "ip": ip,
                "parent_id": parent_id,
                "status": status,
                "reachable": reachable,
                "model": model,
                "firmware": firmware,
            },
            "ssh_info": ssh_info,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// 8. full_wisp_setup — all-in-one setup
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn full_wisp_setup(
    db: State<'_, Database>,
    config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let db_path = db.path.clone();
    tokio::task::spawn_blocking(move || {
        let mut all_steps: Vec<serde_json::Value> = Vec::new();
        let mut all_errors: Vec<String> = Vec::new();

        // Parse config
        let wan_interface = config.get("wan_interface").and_then(|v| v.as_str()).unwrap_or("ether1").to_string();
        let wan_type = config.get("wan_type").and_then(|v| v.as_str()).unwrap_or("dhcp").to_string();
        let pppoe_user = config.get("pppoe_user").and_then(|v| v.as_str()).map(|s| s.to_string());
        let pppoe_password = config.get("pppoe_password").and_then(|v| v.as_str()).map(|s| s.to_string());
        let management_subnet = config.get("management_subnet").and_then(|v| v.as_str()).unwrap_or("192.168.1.0/24").to_string();
        let management_gateway = config.get("management_gateway").and_then(|v| v.as_str()).unwrap_or("192.168.1.1").to_string();
        let client_pool = config.get("client_pool").and_then(|v| v.as_str()).unwrap_or("10.0.0.10-10.0.0.250").to_string();
        let dns_servers = config.get("dns_servers").and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<&str>>().join(","))
            .unwrap_or_else(|| "8.8.8.8,1.1.1.1".to_string());
        let plans: Vec<serde_json::Value> = config.get("plans").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let apply_security = config.get("apply_security").and_then(|v| v.as_bool()).unwrap_or(true);
        let total_bandwidth_down = config.get("total_bandwidth_down").and_then(|v| v.as_i64()).unwrap_or(0);
        let total_bandwidth_up = config.get("total_bandwidth_up").and_then(|v| v.as_i64()).unwrap_or(0);

        // Parse pool range
        let pool_parts: Vec<&str> = client_pool.split('-').collect();
        let pool_start = pool_parts.first().unwrap_or(&"10.0.0.10").to_string();
        let pool_end = pool_parts.get(1).unwrap_or(&"10.0.0.250").to_string();

        let client = make_client(&db_path)?;

        match client.connect() {
            Ok(mut mt) => {
                println!("[Setup:Full] Starting full WISP setup...");
                println!("[Setup:Full] WAN: {} ({})", wan_interface, wan_type);
                println!("[Setup:Full] Management: {}", management_subnet);
                println!("[Setup:Full] Client pool: {}", client_pool);
                println!("[Setup:Full] Plans: {}", plans.len());

                // ==================== PHASE 1: WAN ====================
                println!("\n[Setup:Full] === PHASE 1: WAN Configuration ===");
                {
                    match wan_type.as_str() {
                        "dhcp" => {
                            // Remove existing DHCP clients on WAN interface
                            if let Ok(existing) = mt.query("/ip/dhcp-client/print", &[
                                &format!("?interface={}", wan_interface),
                            ]) {
                                for item in &existing {
                                    if let Some(id) = item.get(".id").and_then(|v| v.as_str()) {
                                        mt.query("/ip/dhcp-client/remove", &[&format!("=.id={}", id)]).ok();
                                    }
                                }
                            }
                            match mt.query("/ip/dhcp-client/add", &[
                                &format!("=interface={}", wan_interface),
                                "=disabled=no",
                                "=add-default-route=yes",
                                "=use-peer-dns=yes",
                                "=comment=LK: WAN DHCP client",
                            ]) {
                                Ok(_) => {
                                    println!("[Setup:Full] OK: DHCP client on {}", wan_interface);
                                    all_steps.push(serde_json::json!({"phase": "wan", "step": "dhcp_client", "status": "ok"}));
                                }
                                Err(e) => {
                                    println!("[Setup:Full] ERROR: DHCP client: {}", e);
                                    all_errors.push(format!("WAN DHCP: {}", e));
                                    all_steps.push(serde_json::json!({"phase": "wan", "step": "dhcp_client", "status": "error", "error": e}));
                                }
                            }
                        }
                        "pppoe" => {
                            let user = pppoe_user.unwrap_or_else(|| "user".to_string());
                            let pass = pppoe_password.unwrap_or_default();
                            // Remove existing PPPoE clients
                            if let Ok(existing) = mt.query("/interface/pppoe-client/print", &[]) {
                                for item in &existing {
                                    if let Some(id) = item.get(".id").and_then(|v| v.as_str()) {
                                        mt.query("/interface/pppoe-client/remove", &[&format!("=.id={}", id)]).ok();
                                    }
                                }
                            }
                            match mt.query("/interface/pppoe-client/add", &[
                                "=name=pppoe-wan",
                                &format!("=interface={}", wan_interface),
                                &format!("=user={}", user),
                                &format!("=password={}", pass),
                                "=disabled=no",
                                "=add-default-route=yes",
                                "=use-peer-dns=yes",
                                "=comment=LK: WAN PPPoE client",
                            ]) {
                                Ok(_) => {
                                    println!("[Setup:Full] OK: PPPoE client on {}", wan_interface);
                                    all_steps.push(serde_json::json!({"phase": "wan", "step": "pppoe_client", "status": "ok"}));
                                }
                                Err(e) => {
                                    println!("[Setup:Full] ERROR: PPPoE client: {}", e);
                                    all_errors.push(format!("WAN PPPoE: {}", e));
                                    all_steps.push(serde_json::json!({"phase": "wan", "step": "pppoe_client", "status": "error", "error": e}));
                                }
                            }
                        }
                        "static" => {
                            all_steps.push(serde_json::json!({"phase": "wan", "step": "static", "status": "ok", "description": "Static WAN - manual IP"}));
                        }
                        _ => {
                            all_errors.push(format!("Unknown WAN type: {}", wan_type));
                        }
                    }

                    // Create interface lists
                    for list_name in &["WAN", "LAN"] {
                        if let Ok(lists) = mt.query("/interface/list/print", &[&format!("?name={}", list_name)]) {
                            if lists.is_empty() {
                                mt.query("/interface/list/add", &[
                                    &format!("=name={}", list_name),
                                    &format!("=comment=LK: {} list", list_name),
                                ]).ok();
                            }
                        }
                    }

                    // Add WAN interface to WAN list
                    let wan_list_iface = if wan_type == "pppoe" { "pppoe-wan".to_string() } else { wan_interface.clone() };
                    if let Ok(members) = mt.query("/interface/list/member/print", &["?list=WAN"]) {
                        for m in &members {
                            if let Some(id) = m.get(".id").and_then(|v| v.as_str()) {
                                mt.query("/interface/list/member/remove", &[&format!("=.id={}", id)]).ok();
                            }
                        }
                    }
                    mt.query("/interface/list/member/add", &[
                        &format!("=interface={}", wan_list_iface),
                        "=list=WAN",
                        "=comment=LK: WAN member",
                    ]).ok();
                }

                // ==================== PHASE 2: LAN ====================
                println!("\n[Setup:Full] === PHASE 2: LAN Configuration ===");
                {
                    // Create bridge-lan
                    let bridge_exists = mt.query("/interface/bridge/print", &["?name=bridge-lan"])
                        .map(|r| !r.is_empty()).unwrap_or(false);
                    if !bridge_exists {
                        match mt.query("/interface/bridge/add", &["=name=bridge-lan", "=comment=LK: LAN bridge"]) {
                            Ok(_) => {
                                println!("[Setup:Full] OK: bridge-lan created");
                                all_steps.push(serde_json::json!({"phase": "lan", "step": "bridge", "status": "ok"}));
                            }
                            Err(e) => {
                                println!("[Setup:Full] ERROR: bridge: {}", e);
                                all_errors.push(format!("Bridge: {}", e));
                            }
                        }
                    } else {
                        all_steps.push(serde_json::json!({"phase": "lan", "step": "bridge", "status": "ok", "description": "already exists"}));
                    }

                    // Add ports to bridge
                    if let Ok(interfaces) = mt.get_interfaces() {
                        let existing_ports: Vec<String> = mt.query("/interface/bridge/port/print", &["?bridge=bridge-lan"])
                            .unwrap_or_default().iter().map(|p| jstr(p, "interface")).collect();

                        for iface in &interfaces {
                            let iface_name = jstr(iface, "name");
                            if jstr(iface, "type") == "ether" && iface_name != wan_interface && !existing_ports.contains(&iface_name) {
                                match mt.query("/interface/bridge/port/add", &[
                                    "=bridge=bridge-lan",
                                    &format!("=interface={}", iface_name),
                                    &format!("=comment=LK: bridge port {}", iface_name),
                                ]) {
                                    Ok(_) => println!("[Setup:Full] OK: {} added to bridge", iface_name),
                                    Err(e) => println!("[Setup:Full] WARN: {} bridge port: {}", iface_name, e),
                                }
                            }
                        }
                    }

                    // Set management IP
                    // Remove old LK IPs on bridge-lan
                    if let Ok(addrs) = mt.get_ip_addresses() {
                        for addr in &addrs {
                            if jstr(addr, "interface") == "bridge-lan" {
                                let comment = addr.get("comment").and_then(|v| v.as_str()).unwrap_or("");
                                if comment.starts_with("LK:") {
                                    if let Some(id) = addr.get(".id").and_then(|v| v.as_str()) {
                                        mt.query("/ip/address/remove", &[&format!("=.id={}", id)]).ok();
                                    }
                                }
                            }
                        }
                    }

                    let (mgmt_gw, mgmt_prefix) = parse_subnet_gateway(&management_subnet);
                    // Use the explicit gateway if provided, otherwise use parsed one
                    let gw_ip = if management_gateway.is_empty() || management_gateway.ends_with(".0") {
                        mgmt_gw
                    } else {
                        management_gateway.clone()
                    };
                    let mgmt_addr = format!("{}/{}", gw_ip, mgmt_prefix);

                    match mt.query("/ip/address/add", &[
                        &format!("=address={}", mgmt_addr),
                        "=interface=bridge-lan",
                        "=comment=LK: management IP",
                    ]) {
                        Ok(_) => {
                            println!("[Setup:Full] OK: Management IP {}", mgmt_addr);
                            all_steps.push(serde_json::json!({"phase": "lan", "step": "management_ip", "status": "ok", "ip": mgmt_addr}));
                        }
                        Err(e) => {
                            println!("[Setup:Full] ERROR: Management IP: {}", e);
                            all_errors.push(format!("Management IP: {}", e));
                        }
                    }

                    // Create IP pool
                    if let Ok(pools) = mt.get_ip_pool() {
                        for pool in &pools {
                            if jstr(pool, "name") == "pool-clientes" {
                                if let Some(id) = pool.get(".id").and_then(|v| v.as_str()) {
                                    mt.query("/ip/pool/remove", &[&format!("=.id={}", id)]).ok();
                                }
                            }
                        }
                    }

                    let pool_range = format!("{}-{}", pool_start, pool_end);
                    match mt.query("/ip/pool/add", &[
                        "=name=pool-clientes",
                        &format!("=ranges={}", pool_range),
                        "=comment=LK: client PPPoE pool",
                    ]) {
                        Ok(_) => {
                            println!("[Setup:Full] OK: pool-clientes {}", pool_range);
                            all_steps.push(serde_json::json!({"phase": "lan", "step": "ip_pool", "status": "ok", "range": pool_range}));
                        }
                        Err(e) => {
                            println!("[Setup:Full] ERROR: IP pool: {}", e);
                            all_errors.push(format!("IP pool: {}", e));
                        }
                    }

                    // Add bridge-lan to LAN list
                    if let Ok(members) = mt.query("/interface/list/member/print", &["?list=LAN"]) {
                        for m in &members {
                            if jstr(m, "interface") == "bridge-lan" {
                                if let Some(id) = m.get(".id").and_then(|v| v.as_str()) {
                                    mt.query("/interface/list/member/remove", &[&format!("=.id={}", id)]).ok();
                                }
                            }
                        }
                    }
                    mt.query("/interface/list/member/add", &[
                        "=interface=bridge-lan",
                        "=list=LAN",
                        "=comment=LK: LAN member",
                    ]).ok();
                }

                // ==================== PHASE 3: PPPoE ====================
                println!("\n[Setup:Full] === PHASE 3: PPPoE Configuration ===");
                {
                    // Determine local address for PPPoE
                    let local_address = {
                        let octets: Vec<&str> = pool_start.split('.').collect();
                        if octets.len() == 4 {
                            format!("{}.{}.{}.1", octets[0], octets[1], octets[2])
                        } else {
                            "10.0.0.1".to_string()
                        }
                    };

                    // Set client subnet IP on the router
                    // Remove old LK client subnet IPs
                    if let Ok(addrs) = mt.get_ip_addresses() {
                        for addr in &addrs {
                            let comment = addr.get("comment").and_then(|v| v.as_str()).unwrap_or("");
                            if comment.contains("LK: client subnet") {
                                if let Some(id) = addr.get(".id").and_then(|v| v.as_str()) {
                                    mt.query("/ip/address/remove", &[&format!("=.id={}", id)]).ok();
                                }
                            }
                        }
                    }

                    // Create profiles
                    let mut first_profile = String::new();
                    for plan in &plans {
                        let plan_name = jstr(plan, "name");
                        let profile_name = plan.get("profile")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| plan_name.to_lowercase().replace(' ', "-"));
                        let download = plan.get("download").and_then(|v| v.as_i64()).unwrap_or(10);
                        let upload = plan.get("upload").and_then(|v| v.as_i64()).unwrap_or(10);
                        let rate_limit = format!("{}M/{}M", upload, download);

                        if first_profile.is_empty() {
                            first_profile = profile_name.clone();
                        }

                        let exists = mt.query("/ppp/profile/print", &[&format!("?name={}", profile_name)])
                            .map(|r| !r.is_empty()).unwrap_or(false);

                        if exists {
                            if let Ok(profiles) = mt.query("/ppp/profile/print", &[&format!("?name={}", profile_name)]) {
                                if let Some(p) = profiles.first() {
                                    if let Some(id) = p.get(".id").and_then(|v| v.as_str()) {
                                        mt.query("/ppp/profile/set", &[
                                            &format!("=.id={}", id),
                                            &format!("=rate-limit={}", rate_limit),
                                            &format!("=local-address={}", local_address),
                                            "=remote-address=pool-clientes",
                                            &format!("=comment=LK: {}", plan_name),
                                        ]).ok();
                                    }
                                }
                            }
                        } else {
                            match mt.query("/ppp/profile/add", &[
                                &format!("=name={}", profile_name),
                                &format!("=rate-limit={}", rate_limit),
                                &format!("=local-address={}", local_address),
                                "=remote-address=pool-clientes",
                                &format!("=comment=LK: {}", plan_name),
                            ]) {
                                Ok(_) => {
                                    println!("[Setup:Full] OK: Profile {} ({})", profile_name, rate_limit);
                                    all_steps.push(serde_json::json!({"phase": "pppoe", "step": "profile", "status": "ok", "profile": profile_name}));
                                }
                                Err(e) => {
                                    println!("[Setup:Full] ERROR: Profile {}: {}", profile_name, e);
                                    all_errors.push(format!("Profile {}: {}", profile_name, e));
                                }
                            }
                        }
                    }

                    // Remove existing LK PPPoE server
                    if let Ok(servers) = mt.query("/interface/pppoe-server/server/print", &[]) {
                        for srv in &servers {
                            let comment = srv.get("comment").and_then(|v| v.as_str()).unwrap_or("");
                            if comment.starts_with("LK:") {
                                if let Some(id) = srv.get(".id").and_then(|v| v.as_str()) {
                                    mt.query("/interface/pppoe-server/server/remove", &[&format!("=.id={}", id)]).ok();
                                }
                            }
                        }
                    }

                    let default_profile = if first_profile.is_empty() { "default".to_string() } else { first_profile };
                    let service_name = config.get("pppoe_service").and_then(|v| v.as_str()).unwrap_or("Linker-WISP");

                    match mt.query("/interface/pppoe-server/server/add", &[
                        &format!("=service-name={}", service_name),
                        "=interface=bridge-lan",
                        &format!("=default-profile={}", default_profile),
                        "=disabled=no",
                        "=comment=LK: PPPoE server",
                    ]) {
                        Ok(_) => {
                            println!("[Setup:Full] OK: PPPoE server (profile={})", default_profile);
                            all_steps.push(serde_json::json!({"phase": "pppoe", "step": "server", "status": "ok"}));
                        }
                        Err(e) => {
                            println!("[Setup:Full] ERROR: PPPoE server: {}", e);
                            all_errors.push(format!("PPPoE server: {}", e));
                        }
                    }

                    // Save plans to DB
                    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;").ok();
                        for plan in &plans {
                            let plan_name = jstr(plan, "name");
                            let profile_name = plan.get("profile")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| plan_name.to_lowercase().replace(' ', "-"));
                            let download = plan.get("download").and_then(|v| v.as_i64()).unwrap_or(10);
                            let upload = plan.get("upload").and_then(|v| v.as_i64()).unwrap_or(10);
                            let price = plan.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0);
                            let id = gen_id();
                            conn.execute(
                                "INSERT INTO plans (id, name, download_mbps, upload_mbps, price, profile_name)
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                                 ON CONFLICT(profile_name) DO UPDATE SET
                                    name=excluded.name, download_mbps=excluded.download_mbps,
                                    upload_mbps=excluded.upload_mbps, price=excluded.price",
                                rusqlite::params![id, plan_name, download, upload, price, profile_name],
                            ).ok();
                        }
                    }
                }

                // ==================== PHASE 4: Security ====================
                if apply_security {
                    println!("\n[Setup:Full] === PHASE 4: Security Configuration ===");

                    // NAT masquerade
                    setup_nat_masquerade(&mut mt, &mut all_steps, &mut all_errors);

                    // Firewall
                    setup_firewall(&mut mt, &mut all_steps, &mut all_errors);

                    // DNS
                    if !dns_servers.is_empty() {
                        match mt.query("/ip/dns/set", &[
                            &format!("=servers={}", dns_servers),
                            "=allow-remote-requests=yes",
                            "=cache-size=4096",
                        ]) {
                            Ok(_) => {
                                println!("[Setup:Full] OK: DNS set to {}", dns_servers);
                                all_steps.push(serde_json::json!({"phase": "security", "step": "dns", "status": "ok", "servers": dns_servers}));
                            }
                            Err(e) => {
                                println!("[Setup:Full] ERROR: DNS: {}", e);
                                all_errors.push(format!("DNS: {}", e));
                            }
                        }
                    } else {
                        setup_dns(&mut mt, &mut all_steps, &mut all_errors);
                    }

                    // Client isolation
                    setup_client_isolation(&mut mt, &mut all_steps, &mut all_errors);

                    // Anti-DDoS
                    setup_anti_ddos(&mut mt, &mut all_steps, &mut all_errors);

                    // Bandwidth limit
                    if total_bandwidth_down > 0 && total_bandwidth_up > 0 {
                        setup_bandwidth_limit(&mut mt, total_bandwidth_down, total_bandwidth_up,
                            &mut all_steps, &mut all_errors);
                    }
                }

                let success = all_errors.is_empty();
                let summary = format!(
                    "Full WISP setup: {} steps completed, {} errors. WAN={} ({}), Management={}, Plans={}",
                    all_steps.len(), all_errors.len(), wan_interface, wan_type,
                    management_subnet, plans.len()
                );

                log_to_db(&db_path, "full_wisp_setup",
                    if success { "OK" } else { "PARTIAL" },
                    &summary,
                    Some(&serde_json::to_string(&serde_json::json!({
                        "steps": all_steps,
                        "errors": all_errors,
                    })).unwrap_or_default()));

                println!("\n[Setup:Full] {}", summary);

                Ok(serde_json::json!({
                    "success": success,
                    "summary": summary,
                    "steps": all_steps,
                    "errors": all_errors,
                    "config_applied": {
                        "wan_interface": wan_interface,
                        "wan_type": wan_type,
                        "management_subnet": management_subnet,
                        "client_pool": client_pool,
                        "plans_count": plans.len(),
                        "security_applied": apply_security,
                    },
                }))
            }
            Err(e) => {
                println!("[Setup:Full] Connection failed: {}", e);
                log_to_db(&db_path, "full_wisp_setup", "ERROR",
                    &format!("Failed to connect: {}", e), None);
                Ok(serde_json::json!({
                    "success": false,
                    "error": format!("No se pudo conectar al MikroTik: {}", e),
                }))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
