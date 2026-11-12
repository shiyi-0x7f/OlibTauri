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

impl From<lan_server::LanStatus> for LanStatusResponse {
    fn from(s: lan_server::LanStatus) -> Self {
        Self {
            running: s.running,
            url: s.url,
            qr_base64: s.qr_base64,
            port: s.port,
            wifi_name: s.wifi_name,
            opds_url: s.opds_url,
        }
    }
}

/// 用户手动开启：成功后记住「开着」和端口，下次启动自动开启（见 dev_docs/lan-server.md）。
/// port 缺省时沿用上次的端口，保证手机记住的 IP:端口 不变。
#[tauri::command]
pub async fn start_lan_server(port: Option<u16>) -> Result<LanStatusResponse, String> {
    let (saved_port, download_folder) =
        config::get_value(|c| (c.lan_port, c.download_folder.clone()))?;
    let port = port.unwrap_or(saved_port);

    let status = lan_server::start(port, download_folder).await?;

    if let Err(e) = config::update_value(|c| {
        c.lan_auto_start = true;
        c.lan_port = port;
    }) {
        log::warn!("⚠️ Failed to remember LAN auto start: {}", e);
    }
    Ok(status.into())
}

/// 用户手动关闭：记住「关着」，下次启动不再自动开启
#[tauri::command]
pub fn stop_lan_server() -> Result<(), String> {
    lan_server::stop()?;
    if let Err(e) = config::update_value(|c| c.lan_auto_start = false) {
        log::warn!("⚠️ Failed to clear LAN auto start: {}", e);
    }
    Ok(())
}

#[tauri::command]
pub fn get_lan_status() -> LanStatusResponse {
    lan_server::get_status().into()
}

/// 应用启动时调用：上次开着就按上次端口后台开启；失败只记日志、保持关闭，不打扰用户。
/// 不改写 lan_auto_start——端口被临时占用时，下次启动仍会再试。
pub async fn auto_start_if_enabled() {
    let Ok((enabled, port, download_folder)) =
        config::get_value(|c| (c.lan_auto_start, c.lan_port, c.download_folder.clone()))
    else {
        return;
    };
    if !enabled {
        return;
    }
    match lan_server::start(port, download_folder).await {
        Ok(s) => log::info!("📶 LAN server auto-started at {}", s.url),
        Err(e) => log::warn!("⚠️ LAN server auto start failed (stays off): {}", e),
    }
}
