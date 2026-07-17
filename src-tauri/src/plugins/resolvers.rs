//! 动态下载源解析器：给「总是取最新版」的内置插件用。
//!
//! 仅 `Origin::Builtin` 的清单可以引用（见 manifest 的安全校验）——动态 URL 无法预置
//! sha256，所以这个能力不对第三方开放。新增解析器 = 在 `resolve()` 里加一个分支。

/// 按名字执行解析器，返回 (下载直链, 权威体积)
pub async fn resolve(client: &reqwest::Client, name: &str) -> Option<(String, u64)> {
    match name {
        "calibre-latest" => calibre_latest(client).await,
        other => {
            log::warn!("⚠️ Unknown resolver: {}", other);
            None
        }
    }
}

/// Calibre 官方便携版入口会 302 到 GitHub release 的最新版安装器。
/// 用 Range 只取 1 字节即可拿到重定向后的最终 URL，再从文件名解析版本号。
async fn calibre_latest(client: &reqwest::Client) -> Option<(String, u64)> {
    const ENTRY: &str = "https://calibre-ebook.com/dist/portable";

    let resp = client
        .get(ENTRY)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await
        .ok()?;
    let asset_url = calibre_asset_from_final(resp.url().as_str())?;

    // 加速代理用 chunked 传输不返回 content-length，权威体积只能从 GitHub 拿
    let size = client
        .head(&asset_url)
        .send()
        .await
        .ok()
        .and_then(|r| r.content_length())
        .unwrap_or(0);

    Some((asset_url, size))
}

/// 从重定向后的最终 URL 解析出规范的 GitHub release 直链。
/// 最终 URL 形如 `https://release-assets.githubusercontent.com/...filename%3Dcalibre-portable-installer-9.11.0.exe...`
fn calibre_asset_from_final(final_url: &str) -> Option<String> {
    let marker = "calibre-portable-installer-";
    let start = final_url.find(marker)? + marker.len();
    let rest = &final_url[start..];
    let end = rest.find(".exe")?;
    let version = &rest[..end];
    if version.is_empty() || !version.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    Some(format!(
        "https://github.com/kovidgoyal/calibre/releases/download/v{v}/calibre-portable-installer-{v}.exe",
        v = version
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_version_from_real_redirect_url() {
        // 官方入口 302 后的真实 URL（签名参数已截短）
        let final_url = "https://release-assets.githubusercontent.com/github-production-release-asset/10332822/b17ed15f?sp=r&rscd=attachment%3B+filename%3Dcalibre-portable-installer-9.11.0.exe&rsct=application%2Foctet-stream";
        assert_eq!(
            calibre_asset_from_final(final_url).as_deref(),
            Some("https://github.com/kovidgoyal/calibre/releases/download/v9.11.0/calibre-portable-installer-9.11.0.exe")
        );
    }

    #[test]
    fn rejects_url_without_installer_name() {
        assert!(calibre_asset_from_final("https://example.com/whatever.exe").is_none());
    }

    #[test]
    fn rejects_malformed_version() {
        assert!(calibre_asset_from_final("https://x/calibre-portable-installer-abc.exe").is_none());
    }
}
