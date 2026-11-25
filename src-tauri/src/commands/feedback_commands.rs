//! 意见反馈：对接 SCC 统一反馈（`/api/v1/client/feedback*`，需 client JWT）。
//!
//! - 登录复用 AI 寻书的 scc 公众号扫码（`prescriber_commands::scc_token`），app_id 由 SCC 从 token 推导。
//! - `app_version` / `platform` 由本端填写，前端不传；设备信息仅在用户勾选同意时附带（所见即所发）。
//! - 契约见 `dev_docs/refs/software_control_center.md`「意见反馈」。

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::prescriber_commands::{parse_scc, scc_token, SCC_URL};

/// 未登录 / token 失效：前端据此弹扫码登录
const ERR_NEED_LOGIN: &str = "NEED_LOGIN";
/// `client_ref` 已被他人占用（409）：前端换新 ref 重试
const ERR_DUPLICATE_REF: &str = "DUPLICATE_REF";

// ===== 设备诊断信息 =====

#[derive(Serialize, Clone)]
pub struct FeedbackDiagnostics {
    /// SCC platform 枚举值；Linux 不在 SCC 支持列表内时为 None（前端禁用提交）
    pub platform: Option<&'static str>,
    pub device_model: Option<String>,
    pub os_version: Option<String>,
    pub app_version: String,
}

fn current_platform() -> Option<&'static str> {
    if cfg!(target_os = "windows") {
        Some("windows")
    } else if cfg!(target_os = "macos") {
        Some("macos")
    } else {
        None
    }
}

/// 从 `reg query` 输出里取某个值：行格式为 `    名称    REG_SZ    值`
// 以下注册表解析辅助函数只被 Windows 的 device_info 调用：其他平台只在测试里编译，
// 否则 CI（Linux）clippy 报 dead_code
#[cfg(any(target_os = "windows", test))]
fn parse_reg_value(output: &str, name: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        if parts.next()? != name {
            return None;
        }
        let _kind = parts.next()?;
        let value = parts.collect::<Vec<_>>().join(" ");
        (!value.is_empty()).then_some(value)
    })
}

/// 主板厂商未填写时的占位值，发出去没有意义
#[cfg(any(target_os = "windows", test))]
fn is_placeholder(value: &str) -> bool {
    let v = value.to_lowercase();
    [
        "to be filled",
        "system product name",
        "system manufacturer",
        "default string",
        "o.e.m",
    ]
    .iter()
    .any(|p| v.contains(p))
}

/// `SystemManufacturer` + `SystemProductName`，如 `LENOVO 21HM`；型号已含厂商名时不重复
#[cfg(any(target_os = "windows", test))]
fn compose_device_model(manufacturer: Option<String>, product: Option<String>) -> Option<String> {
    let clean = |s: Option<String>| s.filter(|v| !is_placeholder(v));
    match (clean(manufacturer), clean(product)) {
        (Some(m), Some(p)) if p.to_lowercase().starts_with(&m.to_lowercase()) => Some(p),
        (Some(m), Some(p)) => Some(format!("{} {}", m, p)),
        (None, Some(p)) => Some(p),
        _ => None,
    }
}

/// 构建号 ≥ 22000 为 Windows 11，再拼 `DisplayVersion`，如 `11 24H2`
#[cfg(any(target_os = "windows", test))]
fn compose_os_version(build: Option<String>, display: Option<String>) -> Option<String> {
    let build: u32 = build?.trim().parse().ok()?;
    let major = if build >= 22000 { "11" } else { "10" };
    Some(match display {
        Some(d) => format!("{} {}", major, d),
        None => major.to_string(),
    })
}

#[cfg(target_os = "windows")]
fn reg_query(key: &str, name: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("reg")
        .args(["query", key, "/v", name])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .ok()?;
    parse_reg_value(&String::from_utf8_lossy(&output.stdout), name)
}

#[cfg(target_os = "windows")]
fn device_info() -> (Option<String>, Option<String>) {
    const BIOS: &str = r"HKLM\HARDWARE\DESCRIPTION\System\BIOS";
    const NT: &str = r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    let model = compose_device_model(
        reg_query(BIOS, "SystemManufacturer"),
        reg_query(BIOS, "SystemProductName"),
    );
    let os = compose_os_version(
        reg_query(NT, "CurrentBuild"),
        reg_query(NT, "DisplayVersion"),
    );
    (model, os)
}

#[cfg(not(target_os = "windows"))]
fn device_info() -> (Option<String>, Option<String>) {
    (None, None)
}

/// 表单里「附带设备信息」旁展示的实际值；提交时发送的也是这一份
#[tauri::command]
pub async fn feedback_diagnostics() -> FeedbackDiagnostics {
    let (device_model, os_version) = tokio::task::spawn_blocking(device_info)
        .await
        .unwrap_or((None, None));
    FeedbackDiagnostics {
        platform: current_platform(),
        device_model,
        os_version,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

// ===== 提交 / 查询 =====

#[derive(Deserialize, Serialize)]
pub struct FeedbackDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual: Option<String>,
}

/// 前端提交的表单（不含 app_version / platform / 设备信息，由本端补齐）
#[derive(Deserialize)]
pub struct FeedbackInput {
    pub client_ref: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub area: String,
    pub severity: Option<String>,
    pub title: String,
    pub content: String,
    pub details: Option<FeedbackDetails>,
    pub diagnostics_consent: bool,
}

#[derive(Serialize, Deserialize)]
pub struct FeedbackSubmitted {
    pub id: i64,
    pub status: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct MyFeedbackItem {
    pub id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub area: String,
    pub title: String,
    pub status: String,
    pub app_version: String,
    pub created_at: String,
    #[serde(default)]
    pub issue_status: Option<String>,
    #[serde(default)]
    pub fixed_in_version: Option<String>,
}

#[derive(Deserialize)]
struct MyFeedbackPage {
    items: Vec<MyFeedbackItem>,
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

fn require_token(app: &AppHandle) -> Result<String, String> {
    scc_token(app)?.ok_or_else(|| ERR_NEED_LOGIN.to_string())
}

/// 先按状态码映射前端要区分的情况，其余交给 `parse_scc`（读 `detail`）
async fn handle<T: serde::de::DeserializeOwned>(
    resp: reqwest::Response,
    ctx: &str,
) -> Result<T, String> {
    match resp.status().as_u16() {
        401 => Err(ERR_NEED_LOGIN.into()),
        409 => Err(ERR_DUPLICATE_REF.into()),
        429 => Err("提交太频繁（每小时最多 10 条），请稍后再试".into()),
        _ => parse_scc(resp, ctx).await,
    }
}

/// 提交反馈。未登录 reject `NEED_LOGIN`，client_ref 冲突 reject `DUPLICATE_REF`。
#[tauri::command]
pub async fn feedback_submit(
    app: AppHandle,
    input: FeedbackInput,
) -> Result<FeedbackSubmitted, String> {
    let token = require_token(&app)?;
    let diag = feedback_diagnostics().await;
    let platform = diag.platform.ok_or("当前系统暂不支持提交反馈")?;

    let mut body = serde_json::json!({
        "client_ref": input.client_ref,
        "type": input.kind,
        "area": input.area,
        "title": input.title,
        "content": input.content,
        "app_version": diag.app_version,
        "platform": platform,
        "diagnostics_consent": input.diagnostics_consent,
    });
    if let Some(severity) = input.severity {
        body["severity"] = severity.into();
    }
    if let Some(details) = input.details {
        body["details"] = serde_json::to_value(details).map_err(|e| e.to_string())?;
    }
    // 设备信息只在用户同意时发送（SCC 侧未同意也会丢弃，这里不依赖服务端兜底）
    if input.diagnostics_consent {
        if let Some(m) = diag.device_model {
            body["device_model"] = m.into();
        }
        if let Some(o) = diag.os_version {
            body["os_version"] = o.into();
        }
    }

    let resp = http()?
        .post(format!("{}/api/v1/client/feedback", SCC_URL))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("提交反馈失败: {}", e))?;
    let result: FeedbackSubmitted = handle(resp, "提交反馈").await.inspect_err(|e| {
        // dev 排查用：带完整报文，不打 token
        log::warn!("feedback submit failed: {} body={}", e, body);
    })?;
    log::info!("📝 feedback submitted: id={}", result.id);
    Ok(result)
}

/// 我的反馈（含处理状态与修复版本）。未登录 reject `NEED_LOGIN`。
#[tauri::command]
pub async fn feedback_list_mine(
    app: AppHandle,
    page: Option<u32>,
) -> Result<Vec<MyFeedbackItem>, String> {
    let token = require_token(&app)?;
    let resp = http()?
        .get(format!("{}/api/v1/client/feedback/mine", SCC_URL))
        .query(&[("page", page.unwrap_or(1)), ("page_size", 50)])
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("获取我的反馈失败: {}", e))?;
    let page: MyFeedbackPage = handle(resp, "获取我的反馈").await?;
    Ok(page.items)
}

#[cfg(test)]
mod tests {
    use super::*;

    const REG_OUT: &str = "\r\nHKEY_LOCAL_MACHINE\\HARDWARE\\DESCRIPTION\\System\\BIOS\r\n    SystemProductName    REG_SZ    ThinkPad X1 Carbon Gen 11\r\n\r\n";

    #[test]
    fn parses_reg_value_with_spaces() {
        assert_eq!(
            parse_reg_value(REG_OUT, "SystemProductName").as_deref(),
            Some("ThinkPad X1 Carbon Gen 11")
        );
        assert_eq!(parse_reg_value(REG_OUT, "Missing"), None);
    }

    #[test]
    fn composes_device_model() {
        let s = |v: &str| Some(v.to_string());
        assert_eq!(
            compose_device_model(s("LENOVO"), s("21HM")).as_deref(),
            Some("LENOVO 21HM")
        );
        // 型号已含厂商名
        assert_eq!(
            compose_device_model(s("ASUS"), s("ASUS TUF Gaming")).as_deref(),
            Some("ASUS TUF Gaming")
        );
        // 主板占位值丢弃
        assert_eq!(
            compose_device_model(s("To be filled by O.E.M."), s("System Product Name")),
            None
        );
    }

    #[test]
    fn composes_os_version() {
        let s = |v: &str| Some(v.to_string());
        assert_eq!(
            compose_os_version(s("26200"), s("25H2")).as_deref(),
            Some("11 25H2")
        );
        assert_eq!(
            compose_os_version(s("19045"), s("22H2")).as_deref(),
            Some("10 22H2")
        );
        assert_eq!(compose_os_version(s("abc"), None), None);
    }
}
