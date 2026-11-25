//! 微信读书扫码中转：手机发起微信读书扫码登录，把二维码推到电脑上显示，
//! 用户用手机微信扫电脑屏幕完成登录（同一台手机无法扫自己屏幕上的码）。
//!
//! 局域网服务不做鉴权（见 dev_docs/mobile-sync.md），为防同网络的人推来假码，
//! 手机生成 4 位识别码，与二维码一起显示在两端，由用户核对一致后再扫；
//! 且只接受微信官方授权确认链接，其余内容一律拒绝显示。

use axum::{http::StatusCode, response::IntoResponse, response::Response, Json};
use serde::Deserialize;

/// 显示二维码：payload `{ qr_base64, code }`
pub const EVENT_WEREAD_QR_SHOW: &str = "lan://weread-qr";
/// 关闭二维码：payload `{ code }`（登录完成 / 取消 / 失败时手机通知）
pub const EVENT_WEREAD_QR_CLOSE: &str = "lan://weread-qr-close";

const CODE_LEN: usize = 4;

#[derive(Deserialize)]
pub struct ShowPayload {
    url: String,
    code: String,
}

#[derive(Deserialize)]
pub struct ClosePayload {
    code: String,
}

/// 只放行 `https://open.weixin.qq.com/connect/confirm?uuid=…`
fn validate_url(raw: &str) -> Result<(), &'static str> {
    let url = reqwest::Url::parse(raw).map_err(|_| "二维码链接无效")?;
    let has_uuid = url.query_pairs().any(|(k, v)| k == "uuid" && !v.is_empty());
    if url.scheme() == "https"
        && url.host_str() == Some("open.weixin.qq.com")
        && url.path() == "/connect/confirm"
        && has_uuid
    {
        Ok(())
    } else {
        Err("只接受微信授权二维码")
    }
}

fn validate_code(code: &str) -> Result<(), &'static str> {
    if code.len() == CODE_LEN && code.chars().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err("识别码需为 4 位数字")
    }
}

/// `POST /api/weread-qr`：生成二维码图片并通知界面弹窗显示
pub async fn show(Json(body): Json<ShowPayload>) -> Response {
    if let Err(detail) = validate_url(&body.url).and_then(|_| validate_code(&body.code)) {
        return crate::lan_server::bad_request(detail);
    }
    let qr_base64 = match crate::lan_server::generate_qr_base64(&body.url) {
        Ok(qr) => qr,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("生成二维码失败: {}", e),
            )
                .into_response()
        }
    };
    log::info!(
        "📱 LAN 微信读书扫码中转：显示二维码（识别码 {}）",
        body.code
    );
    crate::lan_server::emit_event(
        EVENT_WEREAD_QR_SHOW,
        serde_json::json!({ "qr_base64": qr_base64, "code": body.code }),
    );
    Json(serde_json::json!({ "ok": true })).into_response()
}

/// `POST /api/weread-qr/close`：关闭对应识别码的弹窗
pub async fn close(Json(body): Json<ClosePayload>) -> Response {
    if let Err(detail) = validate_code(&body.code) {
        return crate::lan_server::bad_request(detail);
    }
    crate::lan_server::emit_event(
        EVENT_WEREAD_QR_CLOSE,
        serde_json::json!({ "code": body.code }),
    );
    Json(serde_json::json!({ "ok": true })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_wechat_confirm_url() {
        assert!(validate_url("https://open.weixin.qq.com/connect/confirm?uuid=abc").is_ok());
        for bad in [
            "http://open.weixin.qq.com/connect/confirm?uuid=abc",
            "https://open.weixin.qq.com.evil.com/connect/confirm?uuid=abc",
            "https://evil.com/connect/confirm?uuid=abc",
            "https://open.weixin.qq.com/connect/other?uuid=abc",
            "https://open.weixin.qq.com/connect/confirm",
            "https://open.weixin.qq.com/connect/confirm?uuid=",
            "not a url",
        ] {
            assert!(validate_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn code_must_be_four_digits() {
        assert!(validate_code("0427").is_ok());
        for bad in ["", "123", "12345", "12a4", "１２３４"] {
            assert!(validate_code(bad).is_err(), "{bad}");
        }
    }
}
