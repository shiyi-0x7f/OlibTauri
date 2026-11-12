//! 扫码登录：`/wxticket` → 微信 `qrconnect` 取 uuid → 本地生成二维码 →
//! 长轮询 `long.open.weixin.qq.com` → 确认后 `/login` 换令牌并落盘。
//!
//! 微信要求用「扫一扫」识别另一块屏幕上的二维码，桌面端展示、手机扫码正好满足。

use super::client::{self, BASE_URL, USER_AGENT};
use super::session::{self, Session};
use rand::Rng;
use serde::Serialize;
use serde_json::{json, Value};

const WEREAD_APP_ID: &str = "wxab9b71ad2b90ff34";
const QR_SCOPE: &str = "snsapi_userinfo,snsapi_timeline,snsapi_friend";

#[derive(Debug, Serialize)]
pub struct QrStart {
    pub uuid: String,
    /// `data:image/svg+xml;base64,…`
    pub qr_image: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum QrStatus {
    Waiting,
    Scanned,
    Confirmed,
    Expired,
    Declined,
}

#[derive(Debug, Serialize)]
pub struct QrPoll {
    pub status: QrStatus,
    /// 下次轮询需回传的 `last`（微信长轮询协议）。
    pub last: Option<i64>,
}

pub async fn start() -> Result<QrStart, String> {
    let resp = client::with_version_headers(client::http().get(format!("{}/wxticket", BASE_URL)))
        .query(&[("nonceStr", "weread")])
        .send()
        .await
        .map_err(|e| format!("获取扫码票据失败: {}", e))?;
    let ticket = client::parse_body(&resp.text().await.unwrap_or_default(), "扫码票据")?;
    let signature = ticket
        .get("signature")
        .and_then(Value::as_str)
        .ok_or("扫码票据不完整（缺 signature）")?
        .to_string();
    let timestamp = match ticket.get("timeStamp") {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        _ => return Err("扫码票据不完整（缺 timeStamp）".to_string()),
    };

    let resp = client::http()
        .get("https://open.weixin.qq.com/connect/sdk/qrconnect")
        .header("User-Agent", USER_AGENT)
        .query(&[
            ("appid", WEREAD_APP_ID),
            ("noncestr", "weread"),
            ("timestamp", timestamp.as_str()),
            ("scope", QR_SCOPE),
            ("signature", signature.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("获取微信二维码失败: {}", e))?;
    let status = resp.status().as_u16();
    let qr = client::parse_body(&resp.text().await.unwrap_or_default(), "微信二维码")?;
    let code = client::error_code(&qr, "微信二维码")?;
    if code != Some(0) {
        return Err(format!(
            "微信拒绝生成二维码（HTTP {}，code {}）",
            status,
            code.map_or_else(|| "无".to_string(), |c| c.to_string())
        ));
    }
    let uuid = qr
        .get("uuid")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or("微信二维码响应缺少 uuid")?
        .to_string();

    let confirm_url = format!("https://open.weixin.qq.com/connect/confirm?uuid={}", uuid);
    let qr_image = crate::lan_server::generate_qr_base64(&confirm_url)
        .map_err(|e| format!("生成二维码图片失败: {}", e))?;
    Ok(QrStart { uuid, qr_image })
}

/// 单次长轮询；收到确认时完成令牌交换并保存会话。
pub async fn poll(uuid: &str, last: Option<i64>) -> Result<QrPoll, String> {
    let mut query = vec![("f", "json".to_string()), ("uuid", uuid.to_string())];
    if let Some(last) = last {
        query.push(("last", last.to_string()));
    }
    let resp = client::http()
        .get("https://long.open.weixin.qq.com/connect/l/qrconnect")
        .header("User-Agent", "Mozilla/5.0")
        .query(&query)
        .send()
        .await
        .map_err(|e| format!("扫码状态轮询失败: {}", e))?;
    let data = client::parse_body(&resp.text().await.unwrap_or_default(), "扫码状态")?;
    let code = match data.get("wx_errcode") {
        Some(Value::Number(n)) => n.as_i64(),
        Some(Value::String(s)) => s.parse().ok(),
        _ => None,
    };
    match code {
        Some(405) => {
            let wx_code = data
                .get("wx_code")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .ok_or("扫码已确认但未返回授权码")?;
            exchange(wx_code).await?;
            Ok(QrPoll {
                status: QrStatus::Confirmed,
                last: code,
            })
        }
        Some(404) => Ok(QrPoll {
            status: QrStatus::Scanned,
            last: code,
        }),
        Some(408) => Ok(QrPoll {
            status: QrStatus::Waiting,
            last: code,
        }),
        Some(402) => Ok(QrPoll {
            status: QrStatus::Expired,
            last: code,
        }),
        Some(403) => Ok(QrPoll {
            status: QrStatus::Declined,
            last: code,
        }),
        other => Err(format!("未知的扫码状态: {:?}", other)),
    }
}

async fn exchange(wx_code: &str) -> Result<(), String> {
    let device_id = format!("eink334691225{}", client::random_digits(19));
    let timestamp = chrono::Utc::now().timestamp_millis();
    let random: u32 = rand::thread_rng().gen_range(0..1000);
    let body = json!({
        "appFirstInstall": 1,
        "code": wx_code,
        "deviceId": device_id,
        "deviceName": "BOOX",
        "installId": format!("eink31{}", client::random_digits(26)),
        "isAutoLogout": 0,
        "isFromQrcode": 1,
        "random": random,
        "signature": client::sign(timestamp, &device_id, random),
        "timestamp": timestamp,
        "trackId": "",
        "deviceType": 3,
    });
    let map = client::post_login(body, "扫码登录").await?;
    let (vid, access_token, refresh_token) = client::credentials(&map).ok_or_else(|| {
        let code = client::error_code(&map, "扫码登录").ok().flatten();
        format!("扫码登录返回的凭据不完整（code {:?}）", code)
    })?;
    session::save(Session {
        vid,
        access_token,
        refresh_token,
        device_id,
    })?;
    log::info!("微信读书扫码连接成功");
    Ok(())
}
