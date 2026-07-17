//! AI 寻书（阅读锦囊）后端对接。
//!
//! - 微信登录：scc.11xy.cn 的**公众号扫码**（带 scene 的临时二维码，未关注用户扫码即关注公众号）。
//!   `GET /api/v1/client/auth/wechat-qr?app_id=` 建码 → app 内显示二维码 →
//!   轮询 `GET /api/v1/client/auth/wechat-qr/status/{scene_id}`，confirmed 时下发
//!   正式 token + user_id（社群构建另读 `unionid`/`in_wecom`）。
//! - AI 生成：olibai.11xy.cn 的 `POST /api/prescribe`（Bearer 正式 token）。
//! - token 持久化在 app_data/prescriber_auth.json；token 失效时前端按需重新扫码。

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// 统一鉴权中心（社群身份 + 微信公众号登录）。
const SCC_URL: &str = "https://scc.11xy.cn";
/// 本应用在 scc 后台的数字 app_id（注册后填真实值，否则运行时建码会失败）。
const SCC_APP_ID: i64 = 7; // scc 后台注册 OlibTauri 的生产 app_id
/// AI 寻书服务基址。
const AI_URL: &str = "https://olibai.11xy.cn";
/// 本地凭据文件。
const STORE_FILE: &str = "prescriber_auth.json";

// ===== 本地凭据 =====

#[derive(Serialize, Deserialize, Default, Clone)]
struct AuthStore {
    device_id: String,
    olib_token: Option<String>,
    user_id: Option<i64>,
    nickname: Option<String>,
    authorized_at: Option<String>,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))
}

fn load_store(dir: &Path) -> AuthStore {
    let mut store: AuthStore = std::fs::read_to_string(dir.join(STORE_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    if store.device_id.is_empty() {
        store.device_id = uuid::Uuid::new_v4().to_string();
    }
    store
}

fn save_store(dir: &Path, store: &AuthStore) -> Result<(), String> {
    let json = serde_json::to_string(store).map_err(|e| format!("序列化凭据失败: {}", e))?;
    std::fs::write(dir.join(STORE_FILE), json).map_err(|e| format!("写入凭据失败: {}", e))
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(45)) // AI 生成较慢
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

// ===== token 滑动续期 =====

/// token 剩余有效期低于此值时触发续期（scc 签发有效期 7 天，阈值 48h）
const RENEW_THRESHOLD_SECS: i64 = 48 * 3600;

/// 不验签解析 JWT payload 里的 `exp`（客户端只需读过期时间，验签在服务端）
fn token_exp_unix(token: &str) -> Option<i64> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()?
        .get("exp")?
        .as_i64()
}

#[derive(Deserialize)]
struct RenewResp {
    token: String,
    #[serde(default)]
    expires_in: i64,
}

#[cfg(test)]
mod tests {
    use super::token_exp_unix;
    use base64::Engine;

    #[test]
    fn parses_exp_from_jwt_payload() {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(br#"{"sub":"1","type":"client","exp":1784280026}"#);
        let token = format!("eyJhbGciOiJIUzI1NiJ9.{}.fakesig", payload);
        assert_eq!(token_exp_unix(&token), Some(1784280026));
    }

    #[test]
    fn tolerates_padded_base64() {
        let payload = base64::engine::general_purpose::URL_SAFE.encode(br#"{"exp":42}"#);
        let token = format!("h.{}.s", payload);
        assert_eq!(token_exp_unix(&token), Some(42));
    }

    #[test]
    fn invalid_token_returns_none() {
        assert_eq!(token_exp_unix("not-a-jwt"), None);
        assert_eq!(token_exp_unix("a.%%%.c"), None);
        let no_exp = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"sub":"1"}"#);
        assert_eq!(token_exp_unix(&format!("h.{}.s", no_exp)), None);
    }
}

/// 启动时滑动续期：token 剩余 < 48h 时调 scc `POST /auth/renew` 换存新 token。
/// 全程 best-effort——失败静默沿用旧 token（到期由前端引导重新扫码）。
pub async fn renew_token_if_needed(app: &AppHandle) {
    let Ok(dir) = data_dir(app) else { return };
    let mut store = load_store(&dir);
    let Some(token) = store.olib_token.clone() else {
        return;
    };
    let Some(exp) = token_exp_unix(&token) else {
        return;
    };

    let remaining = exp - chrono::Utc::now().timestamp();
    if remaining <= 0 {
        log::info!("scc token 已过期，待用户重新扫码");
        return;
    }
    if remaining >= RENEW_THRESHOLD_SECS {
        return;
    }

    let Ok(client) = http() else { return };
    let resp = client
        .post(format!("{}/api/v1/client/auth/renew", SCC_URL))
        .bearer_auth(&token)
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() => match r.json::<RenewResp>().await {
            Ok(renewed) => {
                store.olib_token = Some(renewed.token);
                if let Err(e) = save_store(&dir, &store) {
                    log::warn!("scc token 续期后保存失败: {}", e);
                } else {
                    log::info!(
                        "🔄 scc token 已续期（新有效期 {:.1} 天）",
                        renewed.expires_in as f64 / 86400.0
                    );
                }
            }
            Err(e) => log::warn!("scc token 续期响应解析失败: {}", e),
        },
        Ok(r) => log::info!("scc token 续期被拒（HTTP {}），沿用旧 token", r.status()),
        Err(e) => log::info!("scc token 续期请求失败（{}），沿用旧 token", e),
    }
}

/// scc 客户端接口为**直返业务 JSON**（非 `{success,data}` 信封），失败为非 2xx + `{"detail"}`。
async fn parse_scc<T: DeserializeOwned>(resp: reqwest::Response, ctx: &str) -> Result<T, String> {
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("{}读取响应失败: {}", ctx, e))?;
    if !status.is_success() {
        let detail = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("detail")
                    .and_then(|d| d.as_str())
                    .map(|s| s.to_string())
            });
        return Err(detail.unwrap_or_else(|| format!("{}失败（HTTP {}）", ctx, status.as_u16())));
    }
    serde_json::from_str::<T>(&text).map_err(|e| format!("{}解析失败: {}", ctx, e))
}

// ===== 后端 DTO =====

#[derive(Deserialize)]
struct WechatQrResp {
    #[serde(default)]
    scene_id: String,
    #[serde(default)]
    qrcode_url: String,
    #[serde(default)]
    expire_seconds: i64,
}

#[derive(Serialize, Deserialize)]
pub struct ReadingTip {
    #[serde(default)]
    pub book_name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub from_ai: bool,
}

#[derive(Serialize, Deserialize)]
pub struct ReadingBag {
    #[serde(default)]
    pub diagnosis: String,
    #[serde(default)]
    pub tips: Vec<ReadingTip>,
}

// ===== 前端返回 DTO =====

#[derive(Serialize)]
pub struct AuthStateDto {
    pub authorized: bool,
}

#[derive(Serialize)]
pub struct LoginQrDto {
    pub qr_url: String,
    pub scene_id: String,
    pub expire_seconds: i64,
}

// ===== 命令 =====

/// 当前是否已登录（本地是否持有正式 token）。
#[tauri::command]
pub async fn prescriber_status(app: AppHandle) -> Result<AuthStateDto, String> {
    let store = load_store(&data_dir(&app)?);
    Ok(AuthStateDto {
        authorized: store.olib_token.is_some(),
    })
}

/// 生成公众号扫码登录二维码（未关注用户扫码即关注公众号）。
#[tauri::command]
pub async fn prescriber_start_login(_app: AppHandle) -> Result<LoginQrDto, String> {
    let resp = http()?
        .get(format!(
            "{}/api/v1/client/auth/wechat-qr?app_id={}",
            SCC_URL, SCC_APP_ID
        ))
        .send()
        .await
        .map_err(|e| format!("获取二维码失败: {}", e))?;
    let qr: WechatQrResp = parse_scc(resp, "获取二维码").await?;
    Ok(LoginQrDto {
        qr_url: qr.qrcode_url,
        scene_id: qr.scene_id,
        expire_seconds: if qr.expire_seconds > 0 {
            qr.expire_seconds
        } else {
            300
        },
    })
}

/// 轮询扫码状态；confirmed 时保存正式 token。返回 "authorized" / "waiting" / "expired"。
#[tauri::command]
pub async fn prescriber_poll_login(app: AppHandle, scene_id: String) -> Result<String, String> {
    let resp = http()?
        .get(format!(
            "{}/api/v1/client/auth/wechat-qr/status/{}",
            SCC_URL, scene_id
        ))
        .send()
        .await
        .map_err(|e| format!("查询登录状态失败: {}", e))?;
    let st: serde_json::Value = parse_scc(resp, "查询登录状态").await?;

    let status = st
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("waiting");
    if status == "confirmed" {
        if let Some(token) = st.get("token").and_then(|v| v.as_str()) {
            let dir = data_dir(&app)?;
            let mut store = load_store(&dir);
            store.olib_token = Some(token.to_string());
            store.user_id = st.get("user_id").and_then(|v| v.as_i64());
            store.nickname = st
                .get("nickname")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            store.authorized_at = Some(chrono::Utc::now().to_rfc3339());
            save_store(&dir, &store)?;

            // 社群构建：依据登录响应（in_wecom）同步社群激活态

            return Ok("authorized".to_string());
        }
    }
    Ok(status.to_string())
}

/// 退出登录（清正式 token，保留 device_id）。
#[tauri::command]
pub async fn prescriber_logout(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let mut store = load_store(&dir);
    store.olib_token = None;
    store.user_id = None;
    store.nickname = None;
    store.authorized_at = None;
    save_store(&dir, &store)?;


    Ok(())
}

/// 生成阅读锦囊。未登录返回 `NEED_LOGIN`，配额返回 `QUOTA_AI_USER`/`QUOTA_AI_GLOBAL`。
#[tauri::command]
pub async fn prescriber_diagnose(
    app: AppHandle,
    input: String,
    input_type: Option<String>,
    language: Option<String>,
) -> Result<ReadingBag, String> {
    let dir = data_dir(&app)?;
    let store = load_store(&dir);
    let token = store.olib_token.clone().ok_or("NEED_LOGIN")?;

    let resp = http()?
        .post(format!("{}/api/prescribe", AI_URL))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "input": input,
            "input_type": input_type.unwrap_or_else(|| "auto".into()),
            "language": language.unwrap_or_else(|| "zh".into()),
        }))
        .send()
        .await
        .map_err(|e| format!("AI 寻书请求失败: {}", e))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取 AI 响应失败: {}", e))?;
    let body: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("AI 响应解析失败: {}", e))?;

    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("NEED_LOGIN".into());
    }
    if status.as_u16() == 429 {
        let detail = body.get("detail").and_then(|v| v.as_str()).unwrap_or("");
        return Err(match detail {
            "QUOTA_EXCEEDED_AI_USER" => "QUOTA_AI_USER".into(),
            "QUOTA_EXCEEDED_AI_GLOBAL" => "QUOTA_AI_GLOBAL".into(),
            _ => "请求太频繁，请稍后再试".into(),
        });
    }
    if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
        let data = body.get("data").cloned().unwrap_or(serde_json::Value::Null);
        let bag: ReadingBag =
            serde_json::from_value(data).map_err(|e| format!("锦囊解析失败: {}", e))?;
        if bag.tips.is_empty() {
            return Err("AI 这次没有给出推荐，换个描述再试".into());
        }
        return Ok(bag);
    }
    let msg = body
        .get("error")
        .or_else(|| body.get("message"))
        .and_then(|v| v.as_str())
        .unwrap_or("AI 寻书失败");
    Err(msg.to_string())
}
