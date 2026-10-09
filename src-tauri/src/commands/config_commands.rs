use crate::{config, hosts};
use serde::Serialize;

#[tauri::command]
pub async fn get_config() -> Result<config::AppConfig, String> {
    config::get_config()
}

#[tauri::command]
pub async fn set_config(mut new_config: config::AppConfig) -> Result<(), String> {
    // 插件位置只能经 set_plugins_location 改（要连带迁移文件）；
    // 前端整份回写的配置可能是迁移前读的旧值，这里以当前值为准
    new_config.plugins_dir = config::get_value(|c| c.plugins_dir.clone())?;
    config::set_config(new_config)
}

#[tauri::command]
pub async fn get_hosts() -> Result<Vec<String>, String> {
    Ok(hosts::get_hosts())
}

#[derive(Serialize, Clone)]
pub struct HostLatency {
    pub index: usize,
    pub domain: String,
    /// Latency in milliseconds, -1 means unreachable
    pub latency_ms: i64,
}

#[tauri::command]
pub async fn ping_hosts() -> Result<Vec<HostLatency>, String> {
    let host_list = hosts::get_hosts();
    let mut handles = Vec::new();

    for (i, host) in host_list.into_iter().enumerate() {
        let domain = host.clone();
        let idx = i;

        handles.push(tokio::spawn(async move {
            let latency_ms = crate::api::ping_host(&domain, 5).await.unwrap_or(-1);
            HostLatency {
                index: idx,
                domain,
                latency_ms,
            }
        }));
    }

    let mut results = Vec::new();
    for handle in handles {
        if let Ok(latency) = handle.await {
            results.push(latency)
        }
    }
    results.sort_by_key(|r| r.index);
    Ok(results)
}

/// Auto-select the fastest host based on ping results
#[tauri::command]
pub async fn auto_select_fastest_host() -> Result<HostLatency, String> {
    let results = ping_hosts().await?;

    let fastest = results
        .iter()
        .filter(|r| r.latency_ms > 0)
        .min_by_key(|r| r.latency_ms)
        .ok_or("所有节点均不可达")?;

    config::update_value(|c| c.host_index = fastest.index)?;

    log::info!(
        "⚡ Auto-selected fastest host: {} ({}ms)",
        fastest.domain,
        fastest.latency_ms
    );
    Ok(fastest.clone())
}

/// Update hosts from subscription URL
#[tauri::command]
pub async fn update_subscription(url: String) -> Result<usize, String> {
    let count = hosts::update_from_subscription(&url).await?;

    // Save the subscription URL to config
    config::update_value(|c| c.subscription_url = url)?;

    // Reset host_index to 0 since the list changed
    config::update_value(|c| c.host_index = 0)?;

    Ok(count)
}

/// Import hosts from user-pasted text
#[tauri::command]
pub async fn import_hosts(text: String) -> Result<usize, String> {
    let count = hosts::import_from_text(&text)?;

    // Reset host_index to 0 since the list changed
    config::update_value(|c| c.host_index = 0)?;

    Ok(count)
}

/// Reset hosts to built-in defaults
#[tauri::command]
pub async fn reset_hosts() -> Result<usize, String> {
    let count = hosts::reset_to_default();

    // Reset host_index to 0
    config::update_value(|c| c.host_index = 0)?;

    // Clear subscription URL
    config::update_value(|c| c.subscription_url = String::new())?;

    Ok(count)
}

/// Get hosts info
#[tauri::command]
pub async fn get_hosts_info() -> Result<hosts::HostsCache, String> {
    Ok(hosts::get_hosts_info())
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
}

fn version_is_newer(latest: &str, current: &str) -> bool {
    let parse =
        |s: &str| -> Vec<u64> { s.split('.').filter_map(|p| p.parse::<u64>().ok()).collect() };
    let l = parse(latest);
    let c = parse(current);
    for i in 0..l.len().max(c.len()) {
        let lv = l.get(i).copied().unwrap_or(0);
        let cv = c.get(i).copied().unwrap_or(0);
        if lv > cv {
            return true;
        }
        if lv < cv {
            return false;
        }
    }
    false
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Olib-Desktop")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // 必须查公开仓库 o-lib：开发仓库 OlibTauri 是私有的，未登录请求一律 404，检测更新会静默失败
    let resp = client
        .get("https://api.github.com/repos/shiyi-0x7f/o-lib/releases/latest")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch latest release: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned status {}", resp.status()));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let tag = json
        .get("tag_name")
        .and_then(|v| v.as_str())
        .ok_or("No tag_name in release response")?;

    let latest = tag.strip_prefix('v').unwrap_or(tag).to_string();

    Ok(UpdateInfo {
        has_update: version_is_newer(&latest, &current),
        current_version: current,
        latest_version: latest,
    })
}
