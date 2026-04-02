mod db;
mod mikrotik;
mod ubiquiti;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            db::init_database(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Auth
            commands::auth::login,
            commands::auth::logout,
            commands::auth::check_session,
            commands::auth::get_settings,
            commands::auth::save_settings,
            // Dashboard
            commands::dashboard::get_dashboard,
            // Clients
            commands::clients::list_clients,
            commands::clients::create_client,
            commands::clients::update_client,
            commands::clients::delete_client,
            commands::clients::toggle_client,
            // Plans
            commands::plans::list_plans,
            commands::plans::create_plan,
            commands::plans::update_plan,
            commands::plans::delete_plan,
            // Payments
            commands::payments::list_payments,
            commands::payments::create_payment,
            commands::payments::delete_payment,
            // Nodes
            commands::nodes::list_nodes,
            commands::nodes::create_node,
            commands::nodes::update_node,
            commands::nodes::delete_node,
            commands::nodes::get_node_status,
            // MikroTik
            commands::mikrotik::get_system_status,
            commands::mikrotik::get_pppoe_sessions,
            commands::mikrotik::health_check,
            // Network
            commands::network::get_network_health,
            commands::network::apply_security,
            commands::network::get_rules,
            commands::network::audit_mikrotik,
            // VPN
            commands::vpn::get_vpn_status,
            commands::vpn::connect_vpn,
            commands::vpn::disconnect_vpn,
            // Alerts
            commands::alerts::list_alerts,
            commands::alerts::mark_alert_read,
            commands::alerts::mark_all_alerts_read,
            commands::alerts::delete_read_alerts,
            commands::alerts::get_recent_alerts,
            // Monitor
            commands::monitor::run_monitor,
            // Discover
            commands::discover::discover_devices,
            commands::discover::auto_detect_topology,
            commands::discover::import_from_mikrotik,
            // Setup wizard
            commands::setup::analyze_mikrotik,
            commands::setup::setup_wan,
            commands::setup::setup_lan,
            commands::setup::setup_pppoe,
            commands::setup::setup_security,
            commands::setup::get_ip_map,
            commands::setup::add_antenna,
            commands::setup::full_wisp_setup,
            // WAN Management
            commands::network::detect_wan,
            commands::network::get_wan_status,
            commands::network::speed_test_wan,
            commands::network::setup_load_balance,
            commands::network::setup_failover,
            commands::network::remove_wan_config,
            // WISP Protection (universal + Starlink)
            commands::protection::get_protection_status,
            commands::protection::apply_protection,
            commands::protection::remove_protection,
            // Antenna provisioning wizard
            commands::antennas::discover_ubnt_devices,
            commands::antennas::connect_ubnt_device,
            commands::antennas::read_ap_config,
            commands::antennas::provision_antenna,
            commands::antennas::verify_antenna,
            commands::antennas::get_saved_aps,
            commands::antennas::save_antenna_node,
        ])
        .run(tauri::generate_context!())
        .expect("error while running linker");
}
