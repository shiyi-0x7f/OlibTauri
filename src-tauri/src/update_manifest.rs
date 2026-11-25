//! 解析 GitHub Release 正文里的「更新清单」隐藏块。
//!
//! 发布时在 Release 正文末尾写一段 HTML 注释（GitHub 页面上不可见）：
//!
//! ```text
//! <!-- olib-update
//! min_version: 3.4.0
//! 百度网盘: https://pan.baidu.com/s/xxx?pwd=xxxx
//! 夸克网盘: https://pan.quark.cn/s/xxx?pwd=xxxx
//! -->
//! ```
//!
//! - `min_version`：低于此版本的客户端强制更新（可省略 = 不强制）
//! - 其余 `名称: 链接` 行：更新对话框里供用户选择的下载渠道（仅接受 http/https）
//!
//! 格式说明见 `dev_docs/update-manifest.md`。

use serde::Serialize;

const BLOCK_START: &str = "<!-- olib-update";
const BLOCK_END: &str = "-->";
const MAX_LINKS: usize = 8;
const MAX_NAME_CHARS: usize = 20;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct UpdateLink {
    pub name: String,
    pub url: String,
}

#[derive(Default, Debug, PartialEq)]
pub struct UpdateManifest {
    pub min_version: Option<String>,
    pub links: Vec<UpdateLink>,
}

/// 从 Release 正文中提取更新清单；没有清单块时返回空清单
pub fn parse(body: &str) -> UpdateManifest {
    let mut manifest = UpdateManifest::default();
    let Some(block) = find_block(body) else {
        return manifest;
    };
    for line in block.lines() {
        let Some((key, value)) = split_key_value(line) else {
            continue;
        };
        if key.eq_ignore_ascii_case("min_version") {
            let v = value.trim_start_matches('v');
            if !v.is_empty() {
                manifest.min_version = Some(v.to_string());
            }
        } else if is_http_url(value)
            && !key.is_empty()
            && key.chars().count() <= MAX_NAME_CHARS
            && manifest.links.len() < MAX_LINKS
        {
            manifest.links.push(UpdateLink {
                name: key.to_string(),
                url: value.to_string(),
            });
        }
    }
    manifest
}

/// 去掉清单块后的正文，用作对话框里的更新说明
pub fn strip(body: &str) -> String {
    match body.find(BLOCK_START) {
        Some(start) => {
            let end = body[start..]
                .find(BLOCK_END)
                .map(|e| start + e + BLOCK_END.len())
                .unwrap_or(body.len());
            format!("{}{}", &body[..start], &body[end..])
                .trim()
                .to_string()
        }
        None => body.trim().to_string(),
    }
}

/// 语义化版本比较：`latest` 是否比 `current` 新（只比较数字段）
pub fn version_is_newer(latest: &str, current: &str) -> bool {
    let parse =
        |s: &str| -> Vec<u64> { s.split('.').filter_map(|p| p.parse::<u64>().ok()).collect() };
    let l = parse(latest);
    let c = parse(current);
    for i in 0..l.len().max(c.len()) {
        let lv = l.get(i).copied().unwrap_or(0);
        let cv = c.get(i).copied().unwrap_or(0);
        if lv != cv {
            return lv > cv;
        }
    }
    false
}

fn find_block(body: &str) -> Option<&str> {
    let start = body.find(BLOCK_START)? + BLOCK_START.len();
    let end = body[start..].find(BLOCK_END)? + start;
    Some(&body[start..end])
}

/// 在第一个半角或全角冒号处切分（链接里的 `https:` 在其后，不受影响）
fn split_key_value(line: &str) -> Option<(&str, &str)> {
    let line = line.trim();
    let idx = line.find([':', '：'])?;
    let sep_len = line[idx..].chars().next()?.len_utf8();
    Some((line[..idx].trim(), line[idx + sep_len..].trim()))
}

fn is_http_url(s: &str) -> bool {
    (s.starts_with("https://") || s.starts_with("http://")) && !s.contains(char::is_whitespace)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BODY: &str = "下载对应平台的安装包即可使用。\n\n本次更新：修复若干问题\n\n<!-- olib-update\nmin_version: v3.4.0\n百度网盘: https://pan.baidu.com/s/abc?pwd=1234\n夸克网盘：https://pan.quark.cn/s/def?pwd=5678\n坏链接: ftp://example.com/x\n备注 没有冒号\n-->\n";

    #[test]
    fn parses_min_version_and_links() {
        let m = parse(BODY);
        assert_eq!(m.min_version.as_deref(), Some("3.4.0"));
        assert_eq!(
            m.links,
            vec![
                UpdateLink {
                    name: "百度网盘".into(),
                    url: "https://pan.baidu.com/s/abc?pwd=1234".into()
                },
                UpdateLink {
                    name: "夸克网盘".into(),
                    url: "https://pan.quark.cn/s/def?pwd=5678".into()
                },
            ]
        );
    }

    #[test]
    fn missing_block_means_no_force_no_links() {
        assert_eq!(parse("普通的更新说明"), UpdateManifest::default());
    }

    #[test]
    fn unterminated_block_is_ignored() {
        assert_eq!(
            parse("说明\n<!-- olib-update\nmin_version: 9.9.9\n"),
            UpdateManifest::default()
        );
    }

    #[test]
    fn strip_removes_block_and_keeps_notes() {
        assert_eq!(
            strip(BODY),
            "下载对应平台的安装包即可使用。\n\n本次更新：修复若干问题"
        );
        assert_eq!(strip("  只有说明  "), "只有说明");
    }

    #[test]
    fn version_comparison() {
        assert!(version_is_newer("3.4.0", "3.3.1"));
        assert!(version_is_newer("3.10.0", "3.9.9"));
        assert!(version_is_newer("3.4.1", "3.4"));
        assert!(!version_is_newer("3.4.0", "3.4.0"));
        assert!(!version_is_newer("3.3.9", "3.4.0"));
    }
}
