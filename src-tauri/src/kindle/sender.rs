//! 组装邮件并通过 SMTP 发送。TLS / STARTTLS、MIME 与非 ASCII 文件名编码均交给 lettre。

use super::{KindleSettings, Security};
use lettre::message::{header::ContentType, Attachment, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use std::path::Path;
use std::time::Duration;

/// 亚马逊 Send to Kindle 支持的附件格式（mobi / azw3 已不再支持）
pub const SUPPORTED_EXTENSIONS: &[&str] =
    &["epub", "pdf", "txt", "doc", "docx", "rtf", "htm", "html"];
/// 亚马逊单个附件上限
pub const MAX_FILE_BYTES: u64 = 200 * 1024 * 1024;
/// 单次 SMTP 读写超时；按操作计时，大附件慢速上传不会被误杀
const SMTP_TIMEOUT: Duration = Duration::from_secs(120);

/// 校验附件格式与大小
pub fn check_attachment(extension: &str, size: u64) -> Result<(), String> {
    let ext = extension.to_ascii_lowercase();
    if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "Kindle 不支持 {} 格式，请先转换为 EPUB",
            ext.to_uppercase()
        ));
    }
    if size > MAX_FILE_BYTES {
        return Err(format!(
            "文件 {:.1} MB，超过亚马逊 200 MB 上限",
            size as f64 / 1024.0 / 1024.0
        ));
    }
    Ok(())
}

fn transport(s: &KindleSettings) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
    let builder = match s.security {
        Security::Tls => AsyncSmtpTransport::<Tokio1Executor>::relay(&s.smtp_host),
        Security::Starttls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&s.smtp_host),
    }
    .map_err(|e| format!("SMTP 服务器配置无效: {}", e))?;
    Ok(builder
        .port(s.smtp_port)
        .credentials(Credentials::new(s.from.clone(), s.password.clone()))
        .timeout(Some(SMTP_TIMEOUT))
        .build())
}

/// 模式配错时常见的现象是超时或握手失败，附带提示另一种加密方式
fn smtp_error(s: &KindleSettings, e: lettre::transport::smtp::Error) -> String {
    let hint = if e.is_timeout() || e.to_string().to_lowercase().contains("tls") {
        match s.security {
            Security::Tls => "；若邮箱服务商标注该端口为 STARTTLS，请切换加密方式",
            Security::Starttls => "；若邮箱服务商标注该端口为 SSL/TLS，请切换加密方式",
        }
    } else {
        ""
    };
    format!(
        "SMTP {}:{} 发送失败: {}{}",
        s.smtp_host, s.smtp_port, e, hint
    )
}

/// 仅连接并登录 SMTP，验证配置；不发信
pub async fn test_connection(s: &KindleSettings) -> Result<(), String> {
    s.validate()?;
    match transport(s)?.test_connection().await {
        Ok(true) => Ok(()),
        Ok(false) => Err("SMTP 服务器未响应".to_string()),
        Err(e) => Err(smtp_error(s, e)),
    }
}

/// 把本地文件作为附件发到 Kindle 地址
pub async fn send_file(s: &KindleSettings, path: &Path) -> Result<(), String> {
    s.validate()?;
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let size = tokio::fs::metadata(path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?
        .len();
    check_attachment(extension, size)?;

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("book")
        .to_string();
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;
    let message = build_message(s, filename, bytes)?;

    transport(s)?
        .send(message)
        .await
        .map_err(|e| smtp_error(s, e))?;
    Ok(())
}

fn build_message(s: &KindleSettings, filename: String, bytes: Vec<u8>) -> Result<Message, String> {
    let octet = ContentType::parse("application/octet-stream")
        .map_err(|e| format!("附件类型无效: {}", e))?;
    Message::builder()
        .from(
            s.from
                .parse()
                .map_err(|_| "发件邮箱格式不正确".to_string())?,
        )
        .to(s
            .to
            .parse()
            .map_err(|_| "Kindle 收件地址格式不正确".to_string())?)
        .subject("Send to Kindle")
        .multipart(
            MultiPart::mixed()
                .singlepart(SinglePart::plain("Sent by Olib.".to_string()))
                .singlepart(Attachment::new(filename).body(bytes, octet)),
        )
        .map_err(|e| format!("组装邮件失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attachment_format_and_size() {
        assert!(check_attachment("EPUB", 1024).is_ok());
        assert!(check_attachment("pdf", MAX_FILE_BYTES).is_ok());
        assert!(check_attachment("mobi", 1024).is_err());
        assert!(check_attachment("azw3", 1024).is_err());
        assert!(check_attachment("epub", MAX_FILE_BYTES + 1).is_err());
    }

    #[test]
    fn builds_message_with_cjk_filename() {
        let s = KindleSettings {
            to: "me@kindle.com".into(),
            from: "me@qq.com".into(),
            smtp_host: "smtp.qq.com".into(),
            smtp_port: 465,
            security: Security::Tls,
            password: "code".into(),
        };
        let msg = build_message(&s, "三体.epub".into(), b"epub-bytes".to_vec()).unwrap();
        let raw = String::from_utf8(msg.formatted()).unwrap();
        assert!(raw.contains("Subject: Send to Kindle"));
        assert!(raw.contains("attachment"));
        // 非 ASCII 文件名应被编码，不以原始 UTF-8 出现在头部
        let headers_of_attachment = raw
            .lines()
            .find(|l| l.contains("filename"))
            .unwrap_or_default();
        assert!(!headers_of_attachment.contains("三体"));
    }
}
