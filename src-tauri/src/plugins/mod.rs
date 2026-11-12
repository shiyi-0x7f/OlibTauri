//! 插件系统：清单驱动的按需扩展能力。
//!
//! - `manifest`  —— 对第三方开放的清单 schema 与安全校验（信任边界在这里）
//! - `installer` —— 通用下载/校验/解压引擎，所有插件共用
//! - `runner`    —— 按清单的 exec 契约调用插件可执行文件
//! - `resolvers` —— 「取最新版」动态解析器，仅内置清单可用
//! - `location`  —— 安装根目录（默认 / 用户自定义）与迁移
//! - `usage`     —— 已装插件的磁盘占用统计
//! - `guide`     —— 内置的插件开发指南（写到 app 数据目录供 AI Agent 读取）
//!
//! 插件目录：内置清单编译进二进制；用户订阅的远程 registry 缓存在 app_data/registries/。

pub mod guide;
pub mod installer;
pub mod location;
pub mod manifest;
pub mod resolvers;
pub mod runner;
pub mod service;
pub mod usage;

use crate::util::LockExt;
use manifest::{Origin, PluginManifest};
use std::path::PathBuf;
use std::sync::Mutex;

/// 内置插件清单（随应用编译，等同应用作者背书）
const BUILTIN_REGISTRY: &str = include_str!("../../plugins.builtin.json");

/// 已加载的全部插件（内置 + 订阅 + 本地导入）
static PLUGINS: Mutex<Option<Vec<PluginManifest>>> = Mutex::new(None);

pub(crate) fn registries_dir(app_data: &std::path::Path) -> PathBuf {
    app_data.join("registries")
}

/// 启动时加载所有清单：内置的 + 之前订阅缓存下来的。
/// 单个 registry 解析失败不影响其他（坏的第三方源不能拖垮内置插件）。
pub fn init(app_data: &std::path::Path) {
    let mut all = match manifest::parse_registry(BUILTIN_REGISTRY, Origin::Builtin) {
        Ok(list) => list,
        Err(e) => {
            // 内置清单坏了属于应用自身缺陷，记录但不 panic
            log::error!("❌ Builtin plugin registry is invalid: {}", e);
            Vec::new()
        }
    };

    let dir = registries_dir(app_data);
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            match std::fs::read_to_string(&path)
                .map_err(|e| e.to_string())
                .and_then(|json| manifest::parse_registry(&json, Origin::Remote))
            {
                Ok(list) => {
                    log::info!("🧩 Loaded {} plugin(s) from {:?}", list.len(), path);
                    all.extend(list);
                }
                Err(e) => log::warn!("⚠️ Ignoring invalid registry {:?}: {}", path, e),
            }
        }
    }

    // id 冲突时内置优先（第三方不能顶替官方插件）
    let mut seen = std::collections::HashSet::new();
    all.retain(|p| seen.insert(p.id.clone()));

    log::info!("🧩 {} plugin(s) available", all.len());
    *PLUGINS.lock_ignore_poison() = Some(all);
}

pub fn all() -> Vec<PluginManifest> {
    PLUGINS.lock_ignore_poison().clone().unwrap_or_default()
}

pub fn find(id: &str) -> Option<PluginManifest> {
    all().into_iter().find(|p| p.id == id)
}

/// 找一个提供指定能力、且已安装好的插件（用户在设置里手动指定的路径优先级更高，
/// 由调用方处理）
pub fn find_installed_by_capability(capability: &str) -> Option<(PluginManifest, PathBuf)> {
    all().into_iter().find_map(|p| {
        if p.capability != capability {
            return None;
        }
        installer::engine_path(&p).map(|exe| (p, exe))
    })
}

/// 订阅一个远程 registry：拉取 → 校验（第三方规则）→ 落盘 → 重新加载。
/// 校验不通过就不落盘，避免把坏清单持久化。
pub async fn subscribe(app_data: &std::path::Path, url: &str) -> Result<usize, String> {
    if !url.starts_with("https://") {
        return Err("插件源必须是 https 地址".to_string());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;
    let json = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("拉取插件源失败: {}", e))?
        .text()
        .await
        .map_err(|e| format!("读取插件源失败: {}", e))?;

    let list = manifest::parse_registry(&json, Origin::Remote)?;
    if list.is_empty() {
        return Err("该插件源没有可用插件".to_string());
    }

    let dir = registries_dir(app_data);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {}", e))?;
    // 用 URL 的哈希做文件名，避免非法字符
    let name = format!("{:x}.json", md5_like(url));
    std::fs::write(dir.join(name), &json).map_err(|e| format!("保存插件源失败: {}", e))?;

    let count = list.len();
    init(app_data);
    Ok(count)
}

/// 简易稳定哈希，仅用于生成文件名（不用于安全用途）
fn md5_like(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 内置清单是应用的一部分，写错了就等于没有插件——必须在 CI 里就拦住
    #[test]
    fn builtin_registry_is_valid() {
        let plugins = manifest::parse_registry(BUILTIN_REGISTRY, Origin::Builtin)
            .expect("builtin registry must parse");
        assert!(!plugins.is_empty(), "builtin registry should not be empty");

        let calibre = plugins
            .iter()
            .find(|p| p.id == "calibre")
            .expect("calibre plugin must exist");
        assert_eq!(calibre.capability, "convert");
        assert!(calibre.exec.is_some(), "calibre is a CLI plugin");
        assert!(calibre.outputs.contains(&"epub".to_string()));

        let ocr = plugins
            .iter()
            .find(|p| p.id == "umi-ocr")
            .expect("ocr plugin must exist");
        assert_eq!(ocr.capability, "ocr");
        // OCR 引擎是常驻服务型，没有 exec；进程生命周期由 service 声明驱动
        assert!(ocr.exec.is_none());
        let svc = ocr.service.as_ref().expect("ocr must declare a service");
        assert!(!svc.health.is_empty(), "service needs a health endpoint");
        assert!(
            !svc.quit_args.is_empty(),
            "service must declare how to shut down, or it leaks an orphan process"
        );
        // 双层可搜索 PDF 是这个能力的产物
        assert_eq!(ocr.outputs, vec!["pdf".to_string()]);
        assert!(ocr.inputs.contains(&"pdf".to_string()));
    }

    /// 动作是「只写 JSON 就能加功能」的扩展点，内置的这几个动作是它的样板——
    /// 写错了不仅功能坏，第三方照抄也会跟着错
    #[test]
    fn builtin_actions_are_wired_correctly() {
        let plugins = manifest::parse_registry(BUILTIN_REGISTRY, Origin::Builtin).unwrap();

        // Calibre 包里同时有 ebook-convert 和 ebook-polish，瘦身动作必须指向后者——
        // 这正是 ActionSpec::entry 覆盖存在的理由，指错了就会拿转换器当润色器调用
        let calibre = plugins.iter().find(|p| p.id == "calibre").unwrap();
        let polish = calibre
            .exec
            .as_ref()
            .unwrap()
            .actions
            .iter()
            .find(|a| a.id == "polish")
            .expect("calibre must expose the polish action");
        assert!(
            polish
                .entry
                .as_deref()
                .unwrap_or("")
                .contains("ebook-polish"),
            "polish must run ebook-polish, not the main entry"
        );
        // 润色只吃 EPUB/AZW3，不能继承 calibre 那一长串转换输入格式
        assert_eq!(polish.accepted_inputs(calibre), ["epub", "azw3"]);

        let pdfcpu = plugins
            .iter()
            .find(|p| p.id == "pdfcpu")
            .expect("pdfcpu plugin must exist");
        let actions = &pdfcpu.exec.as_ref().unwrap().actions;
        assert!(
            actions.iter().any(|a| a.id == "optimize"),
            "pdfcpu must expose optimize"
        );
        // pdfcpu 只有动作、没有默认 args，靠的就是 actions 这条通路
        assert!(pdfcpu.exec.as_ref().unwrap().args.is_empty());
    }

    /// qpdf 修复损坏文件时必然产生警告并以退出码 3 结束，而 runner 要求「退出码 0 且产物存在」
    /// 才算成功——不加 --warning-exit-0，每次修复成功都会被报成失败
    #[test]
    fn qpdf_repair_treats_warnings_as_success() {
        let plugins = manifest::parse_registry(BUILTIN_REGISTRY, Origin::Builtin).unwrap();
        let qpdf = plugins
            .iter()
            .find(|p| p.id == "qpdf")
            .expect("qpdf plugin must exist");
        let repair = qpdf
            .exec
            .as_ref()
            .unwrap()
            .actions
            .iter()
            .find(|a| a.id == "repair")
            .expect("qpdf must expose repair");
        assert!(repair.args.iter().any(|a| a == "--warning-exit-0"));
    }

    /// 产物不换扩展名的动作（瘦身、解锁）必须声明文件名后缀，
    /// 否则产出会退化成「书名 (1).pdf」这种看不出是什么的文件
    #[test]
    fn same_format_actions_declare_a_suffix() {
        let plugins = manifest::parse_registry(BUILTIN_REGISTRY, Origin::Builtin).unwrap();
        for p in &plugins {
            let Some(exec) = &p.exec else { continue };
            for a in &exec.actions {
                if a.output_ext.is_none() {
                    assert!(
                        !a.output_suffix.is_empty(),
                        "action {}/{} keeps the input format but declares no output_suffix",
                        p.id,
                        a.id
                    );
                }
            }
        }
    }

    /// 内置插件也应尽量给出 sha256；锁定版本的下载源没有校验和是明确的退步
    #[test]
    fn version_pinned_builtin_sources_have_checksums() {
        let plugins = manifest::parse_registry(BUILTIN_REGISTRY, Origin::Builtin).unwrap();
        for p in &plugins {
            for (platform, target) in &p.targets {
                // 用动态解析器取「最新版」的插件天然无法预置校验和，豁免
                if target.download.resolver.is_some() {
                    continue;
                }
                assert!(
                    target.download.sha256.is_some(),
                    "plugin {} ({}) pins a fixed URL but declares no sha256",
                    p.id,
                    platform
                );
            }
        }
    }

    /// Calibre 便携版对安装路径长度有硬限制（含它自建的 "Calibre Portable" 子目录须 < 59 字符），
    /// 且超限时安装器退出码仍为 0。这里确保实际安装目录 + 清单声明的上限都在安全范围内。
    #[test]
    fn calibre_install_path_fits_length_limit() {
        let plugins = manifest::parse_registry(BUILTIN_REGISTRY, Origin::Builtin).unwrap();
        let calibre = plugins.iter().find(|p| p.id == "calibre").unwrap();
        let Some(target) = calibre.targets.get("windows") else {
            return;
        };
        let max = target
            .install
            .max_path_len
            .expect("must declare max_path_len");

        // 安装器会在安装目录下再建一层 "Calibre Portable"，总长须 < 59
        assert!(
            max + 1 + "Calibre Portable".len() < 59,
            "declared max_path_len {} leaves no room for the 'Calibre Portable' subdir",
            max
        );

        // 真实安装目录必须落在声明的上限内
        let dir = installer::plugin_dir("calibre");
        let len = dir.to_string_lossy().chars().count();
        assert!(
            len <= max,
            "actual install dir {:?} is {} chars, exceeds declared max {}",
            dir,
            len,
            max
        );
    }
}
