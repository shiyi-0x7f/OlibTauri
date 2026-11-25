use crate::update_manifest::{self, version_is_newer, UpdateLink};
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
    // 无线传书开关由启停命令记录，同理不让设置页的旧副本覆盖
    (new_config.lan_auto_start, new_config.lan_port) =
        config::get_value(|c| (c.lan_auto_start, c.lan_port))?;
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

/// 已移除订阅 / 手动导入节点：旧版留下的非内置节点列表在启动时一次性重置为内置默认，
/// 否则这些用户再无入口回到内置列表。
pub fn migrate_custom_hosts_to_builtin() {
    let source = hosts::get_hosts_info().source;
    if source == "builtin" {
        return;
    }
    let count = hosts::reset_to_default();
    if let Err(e) = config::update_value(|c| c.host_index = 0) {
        log::warn!("重置节点后写入 host_index 失败: {}", e);
    }
    log::info!("节点来源 {} 已停用，重置为内置默认 {} 个", source, count);
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
    /// 当前版本低于 Release 清单里的 min_version：前端弹不可关闭的更新对话框
    pub force_update: bool,
    /// Release 清单里配置的下载渠道（网盘等），供用户选择
    pub links: Vec<UpdateLink>,
    /// 去掉清单块后的 Release 正文（更新说明）
    pub notes: String,
    /// Release 页面地址（GitHub 渠道兜底）
    pub release_url: String,
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Olib-Desktop")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // 必须查公开仓库（2026-10 起名为 OlibTauri，原 o-lib）；私有开发仓库未登录请求一律 404
    let resp = client
        .get("https://api.github.com/repos/shiyi-0x7f/OlibTauri/releases/latest")
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
    let body = json
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let manifest = update_manifest::parse(body);
    let force_update = manifest
        .min_version
        .as_deref()
        .is_some_and(|min| version_is_newer(min, &current));

    Ok(UpdateInfo {
        has_update: version_is_newer(&latest, &current),
        force_update,
        links: manifest.links,
        notes: update_manifest::strip(body),
        release_url: json
            .get("html_url")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        current_version: current,
        latest_version: latest,
    })
}
