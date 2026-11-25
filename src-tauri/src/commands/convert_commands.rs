//! 格式转换：capability = "convert" 的插件之上的一层薄壳。
//! 下载/安装/进度/调用等通用逻辑都在 `crate::plugins` 里，这里只处理转换特有的部分
//! （引擎发现顺序、格式白名单、输出路径）。

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::commands::bookshelf_commands::ensure_within_download_root;
use crate::config;
use crate::plugins::{self, manifest::PluginManifest, runner};

const CAPABILITY: &str = "convert";
/// 手动指定的路径与系统安装的 Calibre 都是 ebook-convert，其调用约定由内置的 calibre 清单描述
const CALIBRE_ID: &str = "calibre";

#[cfg(target_os = "windows")]
const ENGINE_EXE: &str = "ebook-convert.exe";
#[cfg(not(target_os = "windows"))]
const ENGINE_EXE: &str = "ebook-convert";

#[derive(Debug, Serialize)]
pub struct EngineInfo {
    pub available: bool,
    pub path: String,
    pub version: String,
    /// 该引擎支持的目标格式（来自插件清单）
    pub outputs: Vec<String>,
    /// 该引擎能吃进去的格式（来自插件清单）
    pub inputs: Vec<String>,
}

/// 转换引擎发现顺序，返回可执行文件**和与之匹配的清单**：
/// 1. 用户在设置里手动指定的路径（最高优先级，可指向自行安装的 Calibre）
/// 2. 已安装的 convert 插件
/// 3. 系统里自行安装的 Calibre（常见位置 + PATH）
///
/// 清单必须和二进制配套返回——`exec.args` 是针对特定程序写的，一旦第三方也提供
/// convert 插件，拿 A 插件的参数去调 B 的可执行文件就会出错。
fn resolve_engine() -> Option<(PathBuf, PluginManifest)> {
    // 1. 手动指定（这类路径指向的就是 Calibre，用内置 calibre 清单的调用约定）
    if let Ok(cfg) = config::get_config() {
        let custom = cfg.calibre_path.trim().to_string();
        if !custom.is_empty() {
            let p = PathBuf::from(custom);
            let exe = if p.is_file() {
                Some(p)
            } else if p.join(ENGINE_EXE).is_file() {
                Some(p.join(ENGINE_EXE))
            } else {
                None
            };
            if let Some(exe) = exe {
                if let Some(calibre) = plugins::find(CALIBRE_ID) {
                    return Some((exe, calibre));
                }
            }
        }
    }

    // 2. 已安装的插件（用它自己的清单）
    if let Some((plugin, exe)) = plugins::find_installed_by_capability(CAPABILITY) {
        return Some((exe, plugin));
    }

    // 3. 系统安装的 Calibre
    let calibre = plugins::find(CALIBRE_ID)?;
    for p in system_calibre_paths() {
        if p.is_file() {
            return Some((p, calibre));
        }
    }
    std::env::var_os("PATH")
        .and_then(|paths| {
            std::env::split_paths(&paths)
                .map(|dir| dir.join(ENGINE_EXE))
                .find(|c| c.is_file())
        })
        .map(|exe| (exe, calibre))
}

fn system_calibre_paths() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        vec![
            PathBuf::from(r"C:\Program Files\Calibre2\ebook-convert.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Calibre2\ebook-convert.exe"),
        ]
    }
    #[cfg(target_os = "macos")]
    {
        vec![PathBuf::from(
            "/Applications/calibre.app/Contents/MacOS/ebook-convert",
        )]
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        vec![
            PathBuf::from("/usr/bin/ebook-convert"),
            PathBuf::from("/usr/local/bin/ebook-convert"),
            PathBuf::from("/opt/calibre/ebook-convert"),
        ]
    }
}

/// 探测转换引擎是否可用。
/// 注意：即使引擎未安装也会返回清单声明的格式列表——它描述的是「这个能力支持什么」，
/// 与是否已安装无关。否则书架右键菜单会因为格式列表为空而根本不显示转换入口，
/// 用户就无从发现这个功能、也无从触发安装。
#[tauri::command]
pub async fn detect_convert_engine() -> Result<EngineInfo, String> {
    let declared = plugins::all()
        .into_iter()
        .find(|p| p.capability == CAPABILITY)
        .map(|p| (p.inputs, p.outputs))
        .unwrap_or_default();

    let Some((exe, plugin)) = resolve_engine() else {
        return Ok(EngineInfo {
            available: false,
            path: String::new(),
            version: String::new(),
            inputs: declared.0,
            outputs: declared.1,
        });
    };

    let mut cmd = tokio::process::Command::new(&exe);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let version = match cmd.output().await {
        Ok(out) => String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .to_string(),
        Err(_) => String::new(),
    };

    Ok(EngineInfo {
        available: true,
        path: exe.to_string_lossy().to_string(),
        version,
        inputs: plugin.inputs,
        outputs: plugin.outputs,
    })
}

/// 启动一次格式转换，返回任务 id；进度通过 get_plugin_tasks 轮询
#[tauri::command]
pub async fn convert_book(
    app_handle: tauri::AppHandle,
    input_path: String,
    target_format: String,
) -> Result<String, String> {
    // 先定引擎，再用与之配套的清单校验格式、展开参数——两者必须来自同一个插件
    let (exe, plugin) =
        resolve_engine().ok_or("转换引擎不可用，请先在「插件」页安装格式转换引擎")?;

    let target = target_format.trim().to_lowercase();
    if !plugin.outputs.iter().any(|o| o == &target) {
        return Err(format!("不支持的目标格式: {}", target_format));
    }

    let canonical = ensure_within_download_root(Path::new(&input_path))?;
    // 进程参数用去前缀路径（外部工具不认 \\?\），任务表存规范化路径（与 list_files 一致，前端按它匹配）
    let input = runner::simplify_path(canonical.clone());
    if !input.is_file() {
        return Err("文件不存在".to_string());
    }
    let current_ext = input
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if current_ext == target {
        return Err("目标格式与当前格式相同".to_string());
    }

    let registry_path = canonical.to_string_lossy().to_string();
    if runner::is_running(&registry_path) {
        return Err("该文件正在转换中".to_string());
    }

    // 转换必然换扩展名，不需要文件名后缀来避免覆盖
    let output = runner::unique_output_path(&input, "", &target);

    runner::spawn_task(
        app_handle,
        &plugin,
        exe,
        input,
        registry_path,
        output,
        target,
    )
}
