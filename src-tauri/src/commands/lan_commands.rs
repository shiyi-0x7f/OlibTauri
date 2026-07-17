use crate::config;
use crate::lan_server;
use serde::Serialize;

#[derive(Serialize)]
pub struct LanStatusResponse {
    pub running: bool,
    pub url: String,
    pub qr_base64: String,
    pub port: u16,
    pub wifi_name: String,
    pub opds_url: String,
}

#[tauri::command]
pub async fn start_lan_server(port: Option<u16>) -> Result<LanStatusResponse, String> {
    let port = port.unwrap_or(8765);
    let download_folder = config::get_value(|c| c.download_folder.clone())?;

    let status = lan_server::start(port, download_folder).await?;

    Ok(LanStatusResponse {
        running: status.running,
        url: status.url,
        qr_base64: status.qr_base64,
        port: status.port,
        wifi_name: status.wifi_name,
        opds_url: status.opds_url,
    })
}

#[tauri::command]
pub fn stop_lan_server() -> Result<(), String> {
    lan_server::stop()
}

#[tauri::command]
pub fn get_lan_status() -> LanStatusResponse {
    let status = lan_server::get_status();
    LanStatusResponse {
        running: status.running,
        url: status.url,
        qr_base64: status.qr_base64,
        port: status.port,
        wifi_name: status.wifi_name,
        opds_url: status.opds_url,
    }
}
