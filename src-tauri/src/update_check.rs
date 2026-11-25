//! 检查更新：只查 MindSet（www.11xy.cn）的项目查更新接口，国内可直连。
//!
//! `GET /api/projects/olib-电脑端/update-check?current=x.y.z` → `{ latest_version, min_version,
//! has_update, force, releases[], page_url }`。版本比较与强制更新判定（后台 `min_version` /
//! 勾选 `is_critical` 的版本）均在服务端完成，客户端只照单展示。
//! 接口见 platform/mindset/dev_docs/API接口文档.md「发版记录 / 客户端查更新 / 强制更新」。
//!
//! 注：3.6.0 及以前的客户端查的是 GitHub Release 正文清单块，发版时仍需维护（见 dev_docs/release-process.md）。

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// MindSet 项目 slug「olib-电脑端」（已 URL 编码）
const UPDATE_CHECK_URL: &str =
    "https://www.11xy.cn/api/projects/olib-%E7%94%B5%E8%84%91%E7%AB%AF/update-check";
/// 公开下载渠道（网盘分享链接由 PanSync 同步）；取不到不影响查更新
const SOURCES_URL: &str =
    "https://www.11xy.cn/api/projects/olib-%E7%94%B5%E8%84%91%E7%AB%AF/sources";
/// 项目页（下载入口）：接口未返回 page_url 时兜底
const PROJECT_PAGE_URL: &str = "https://www.11xy.cn/projects/olib-%E7%94%B5%E8%84%91%E7%AB%AF";
const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
struct Source {
    source_type: String,
    #[serde(default)]
    url: Option<String>,
    /// 会员 / 加密渠道：公开接口不给可用链接，跳过
    #[serde(default)]
    locked: bool,
}

/// 更新对话框里的一个下载按钮
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct UpdateLink {
    pub name: String,
    pub url: String,
}

fn source_name(source_type: &str) -> Option<&'static str> {
    match source_type {
        "baidu_pan" => Some("百度网盘"),
        "quark_pan" => Some("夸克网盘"),
        "xunlei_pan" => Some("迅雷网盘"),
        _ => None,
    }
}

/// 只保留公开可用的网盘链接（分享链接已含 ?pwd=），按百度 / 夸克 / 迅雷排序
fn to_links(sources: Vec<Source>) -> Vec<UpdateLink> {
    const ORDER: [&str; 3] = ["baidu_pan", "quark_pan", "xunlei_pan"];
    let mut links: Vec<(usize, UpdateLink)> = sources
        .into_iter()
        .filter(|s| !s.locked)
        .filter_map(|s| {
            let name = source_name(&s.source_type)?;
            let url = s.url.filter(|u| u.starts_with("http"))?;
            let rank = ORDER
                .iter()
                .position(|t| *t == s.source_type)
                .unwrap_or(ORDER.len());
            Some((
                rank,
                UpdateLink {
                    name: name.to_string(),
                    url,
                },
            ))
        })
        .collect();
    links.sort_by_key(|(rank, _)| *rank);
    links.into_iter().map(|(_, l)| l).collect()
}

#[derive(Debug, Deserialize)]
struct Release {
    version: String,
    #[serde(default)]
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateCheckResponse {
    latest_version: Option<String>,
    #[serde(default)]
    has_update: bool,
    #[serde(default)]
    force: bool,
    #[serde(default)]
    releases: Vec<Release>,
    #[serde(default)]
    page_url: Option<String>,
}

/// 前端 `UpdateInfo`（src/api/config.ts）
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    /// 服务端判定须强制更新：前端弹不可关闭的更新对话框
    pub force_update: bool,
    /// 比当前版本新的各版本更新说明（新→旧）
    pub notes: String,
    /// 网盘下载直链（可能为空，此时只剩官网按钮）
    pub links: Vec<UpdateLink>,
    /// 下载页（MindSet 项目页）：兜底渠道
    pub page_url: String,
}

/// 多个版本的更新说明合并展示：只有一个版本时不加标题
fn merge_notes(releases: &[Release]) -> String {
    let with_notes: Vec<&Release> = releases
        .iter()
        .filter(|r| r.notes.as_deref().is_some_and(|n| !n.trim().is_empty()))
        .collect();
    match with_notes.as_slice() {
        [] => String::new(),
        [only] => only.notes.as_deref().unwrap_or_default().trim().to_string(),
        many => many
            .iter()
            .map(|r| {
                format!(
                    "v{}\n{}",
                    r.version,
                    r.notes.as_deref().unwrap_or_default().trim()
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
    }
}

fn to_update_info(resp: UpdateCheckResponse, links: Vec<UpdateLink>, current: &str) -> UpdateInfo {
    let page_url = resp
        .page_url
        .filter(|u| u.starts_with("http"))
        .unwrap_or_else(|| PROJECT_PAGE_URL.to_string());
    UpdateInfo {
        has_update: resp.has_update,
        current_version: current.to_string(),
        latest_version: resp.latest_version.unwrap_or_else(|| current.to_string()),
        force_update: resp.force,
        notes: merge_notes(&resp.releases),
        links,
        page_url,
    }
}

async fn fetch_update(
    client: &reqwest::Client,
    current: &str,
) -> Result<UpdateCheckResponse, String> {
    let resp = client
        .get(UPDATE_CHECK_URL)
        .query(&[("current", current)])
        .send()
        .await
        .map_err(|e| format!("检查更新请求失败: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("检查更新失败（HTTP {}）", status.as_u16()));
    }
    resp.json()
        .await
        .map_err(|e| format!("检查更新响应解析失败: {}", e))
}

async fn fetch_sources(client: &reqwest::Client) -> Result<Vec<Source>, String> {
    let resp = client
        .get(SOURCES_URL)
        .send()
        .await
        .map_err(|e| format!("获取下载渠道失败: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("获取下载渠道失败（HTTP {}）", status.as_u16()));
    }
    resp.json()
        .await
        .map_err(|e| format!("下载渠道响应解析失败: {}", e))
}

/// 查询更新；查更新失败返回 Err，由前端放行（检测失败不拦用户）。
/// 下载渠道与查更新并发请求，渠道失败只记日志、退回官网按钮。
pub async fn check(current: &str) -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent("Olib-Desktop")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    let (update, sources) = tokio::join!(fetch_update(&client, current), fetch_sources(&client));
    let update = update?;
    let links = match sources {
        Ok(s) => to_links(s),
        Err(e) => {
            log::warn!("[update_check] {}", e);
            Vec::new()
        }
    };
    Ok(to_update_info(update, links, current))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> UpdateCheckResponse {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn maps_force_and_latest() {
        let info = to_update_info(
            parse(
                r#"{"current_version":"3.4.0","latest_version":"3.6.0","min_version":"3.6.0",
                "has_update":true,"force":true,"releases":[
                  {"id":6,"version":"3.6.0","notes":"- 新功能 A","is_critical":true},
                  {"id":5,"version":"3.5.0","notes":"- 修复 B","is_critical":false}],
                "page_url":"https://www.11xy.cn/projects/olib-电脑端"}"#,
            ),
            vec![],
            "3.4.0",
        );
        assert!(info.has_update && info.force_update);
        assert_eq!(info.latest_version, "3.6.0");
        assert_eq!(info.notes, "v3.6.0\n- 新功能 A\n\nv3.5.0\n- 修复 B");
        assert_eq!(info.page_url, "https://www.11xy.cn/projects/olib-电脑端");
    }

    #[test]
    fn single_release_notes_without_heading_and_skips_empty() {
        let info = to_update_info(
            parse(
                r#"{"latest_version":"3.6.0","has_update":true,"force":false,"releases":[
                  {"version":"3.6.0","notes":null},{"version":"3.5.0","notes":"  只有这条  "}]}"#,
            ),
            vec![],
            "3.4.0",
        );
        assert!(!info.force_update);
        assert_eq!(info.notes, "只有这条");
        // page_url 缺失时回落项目页
        assert_eq!(info.page_url, PROJECT_PAGE_URL);
    }

    #[test]
    fn links_keep_public_pans_in_fixed_order() {
        let sources: Vec<Source> = serde_json::from_str(
            r#"[
              {"source_type":"xunlei_pan","url":"https://pan.xunlei.com/s/x?pwd=1","locked":false},
              {"source_type":"quark_pan","url":"https://pan.quark.cn/s/q?pwd=2"},
              {"source_type":"object_storage","url":null,"locked":true,"files":["a.exe"]},
              {"source_type":"baidu_pan","url":"https://pan.baidu.com/s/b?pwd=3","locked":false},
              {"source_type":"baidu_pan","url":"https://pan.baidu.com/s/vip","locked":true},
              {"source_type":"direct","url":"https://example.com/a.exe"},
              {"source_type":"quark_pan","url":""}
            ]"#,
        )
        .unwrap();
        let names: Vec<String> = to_links(sources).into_iter().map(|l| l.name).collect();
        assert_eq!(names, ["百度网盘", "夸克网盘", "迅雷网盘"]);
    }

    #[test]
    fn up_to_date_and_relative_page_url() {
        let info = to_update_info(
            parse(
                r#"{"latest_version":null,"has_update":false,"force":false,"releases":[],
                "page_url":"/projects/olib-电脑端"}"#,
            ),
            vec![],
            "3.6.1",
        );
        assert!(!info.has_update && !info.force_update);
        assert_eq!(info.latest_version, "3.6.1");
        assert_eq!(info.notes, "");
        assert_eq!(info.page_url, PROJECT_PAGE_URL);
    }
}
