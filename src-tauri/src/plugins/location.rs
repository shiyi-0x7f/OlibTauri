//! 插件安装位置：默认 %ProgramData%\Olib\plugins，用户可改到任意可写目录。
//!
//! 改位置时把已装插件整体迁过去（同盘直接改名，跨盘复制后删除），
//! 否则旧位置的插件会变成「未安装」、得重新下载。中途失败会把已迁的搬回去。
//! 只迁移已知插件 id 的子目录——用户选的旧目录里可能还有别的东西，不能动。

use crate::config;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use super::{installer, runner, service};

/// 迁移进行中：期间拒绝安装 / 再次迁移
static RELOCATING: AtomicBool = AtomicBool::new(false);

pub fn is_relocating() -> bool {
    RELOCATING.load(Ordering::SeqCst)
}

/// 默认安装根目录。刻意选 %ProgramData%\Olib 这种短路径：
/// 某些安装器（Calibre 便携版）对路径长度有硬限制，app_data 路径太长会失败。
pub fn default_root() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let program_data =
            std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".to_string());
        PathBuf::from(program_data).join("Olib").join("plugins")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join(".olib").join("plugins")
    }
}

/// 当前生效的安装根目录：设置里指定了就用指定的，否则用默认
pub fn root() -> PathBuf {
    match config::get_value(|c| c.plugins_dir.clone()) {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir.trim()),
        _ => default_root(),
    }
}

#[derive(Debug, Serialize)]
pub struct PluginsLocation {
    pub path: String,
    pub default_path: String,
    pub is_default: bool,
    /// 在该位置会出问题的插件（目前只有路径长度限制）
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RelocateReport {
    pub location: PluginsLocation,
    /// 已迁到新位置的插件名
    pub moved: Vec<String>,
    /// 新位置已有同名目录、未迁移的插件名（旧目录原样保留）
    pub kept: Vec<String>,
}

pub fn location() -> PluginsLocation {
    describe(&root())
}

fn describe(root: &Path) -> PluginsLocation {
    let default = default_root();
    PluginsLocation {
        path: root.to_string_lossy().to_string(),
        default_path: default.to_string_lossy().to_string(),
        is_default: same_path(root, &default),
        warnings: length_warnings(root),
    }
}

/// 清单声明了 max_path_len 的插件（Calibre 便携版），在过长的目录下会安装失败
fn length_warnings(root: &Path) -> Vec<String> {
    super::all()
        .iter()
        .filter_map(|p| {
            let max = p.target()?.install.max_path_len?;
            let len = root.join(&p.id).to_string_lossy().chars().count();
            (len > max).then(|| {
                format!(
                    "「{}」要求安装目录不超过 {} 个字符，此位置为 {} 个，将无法在这里安装",
                    p.name, max, len
                )
            })
        })
        .collect()
}

/// 比较两个目录是否相同（忽略末尾分隔符；Windows 不区分大小写）
fn same_path(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        let s = p
            .to_string_lossy()
            .trim_end_matches(['\\', '/'])
            .to_string();
        if cfg!(target_os = "windows") {
            s.to_lowercase()
        } else {
            s
        }
    };
    norm(a) == norm(b)
}

/// 把安装位置改到 `new_dir`（None / 空串 = 恢复默认），并迁移已装插件
pub async fn relocate(new_dir: Option<String>) -> Result<RelocateReport, String> {
    let new_root = match new_dir.as_deref().map(str::trim) {
        Some(d) if !d.is_empty() => PathBuf::from(d),
        _ => default_root(),
    };
    if !new_root.is_absolute() {
        return Err("请选择一个完整的文件夹路径".to_string());
    }
    let old_root = root();
    if !same_path(&new_root, &old_root) && new_root.starts_with(&old_root) {
        return Err("新位置不能放在当前插件目录里面".to_string());
    }
    if installer::any_installing() {
        return Err("有插件正在安装，请等安装结束后再更改位置".to_string());
    }
    if runner::all_tasks()
        .iter()
        .any(|t| t.status == runner::TaskStatus::Running)
    {
        return Err("有插件任务正在运行（转换 / OCR 等），请等它结束后再更改位置".to_string());
    }
    if RELOCATING.swap(true, Ordering::SeqCst) {
        return Err("正在迁移插件，请稍候".to_string());
    }
    let _guard = RelocatingGuard;

    let plugins = super::all();
    let (moved, kept) = tokio::task::spawn_blocking(move || -> Result<_, String> {
        if same_path(&new_root, &old_root) {
            return Ok((new_root, Vec::new(), Vec::new()));
        }
        // 迁移前停掉我们拉起的常驻服务（OCR），否则其文件被占用、目录挪不动
        service::shutdown_all();
        ensure_writable(&new_root)?;

        let mut moved: Vec<(String, PathBuf, PathBuf)> = Vec::new();
        let mut kept = Vec::new();
        for p in &plugins {
            let src = old_root.join(&p.id);
            if !src.exists() {
                continue;
            }
            let dst = new_root.join(&p.id);
            if dst.exists() {
                kept.push(p.name.clone());
                continue;
            }
            if let Err(e) = move_dir(&src, &dst) {
                // 回滚：把已迁过去的搬回原处，保证要么全迁、要么全不迁
                for (_, from, to) in moved.iter().rev() {
                    if let Err(err) = move_dir(to, from) {
                        log::error!("❌ Rollback {:?} -> {:?} failed: {}", to, from, err);
                    }
                }
                return Err(format!("迁移「{}」失败：{}", p.name, e));
            }
            log::info!("📦 Moved plugin {} -> {:?}", p.id, dst);
            moved.push((p.name.clone(), src, dst));
        }
        // 旧根目录空了就顺手删掉（非空说明还有别的东西，不动）
        let _ = std::fs::remove_dir(&old_root);
        Ok((
            new_root,
            moved.into_iter().map(|(name, _, _)| name).collect(),
            kept,
        ))
    })
    .await
    .map_err(|e| format!("迁移任务异常: {}", e))?
    .and_then(|(root, moved, kept)| {
        let value = if same_path(&root, &default_root()) {
            String::new()
        } else {
            root.to_string_lossy().to_string()
        };
        config::update_value(|c| c.plugins_dir = value)?;
        Ok((moved, kept))
    })?;

    Ok(RelocateReport {
        location: location(),
        moved,
        kept,
    })
}

struct RelocatingGuard;

impl Drop for RelocatingGuard {
    fn drop(&mut self) {
        RELOCATING.store(false, Ordering::SeqCst);
    }
}

fn ensure_writable(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("无法创建文件夹 {}：{}", dir.display(), e))?;
    let probe = dir.join(".olib-write-test");
    std::fs::write(&probe, b"ok")
        .map_err(|e| format!("该文件夹不可写入（{}）：{}", dir.display(), e))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// 同盘直接改名；改名失败（跨盘等）就复制后删除源目录
fn move_dir(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    if std::fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    if let Err(e) = copy_dir(src, dst) {
        let _ = std::fs::remove_dir_all(dst);
        return Err(e);
    }
    std::fs::remove_dir_all(src).map_err(|e| {
        // 新位置已完整，旧目录删不掉（文件被占用等）不影响使用，但要让用户知道
        format!(
            "已复制到新位置，但删除旧目录失败（可手动删除 {}）：{}",
            src.display(),
            e
        )
    })
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("创建目录失败: {}", e))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取目录失败: {}", e))?;
        let to = dst.join(entry.file_name());
        let ty = entry
            .file_type()
            .map_err(|e| format!("读取文件信息失败: {}", e))?;
        if ty.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to)
                .map_err(|e| format!("复制 {} 失败: {}", entry.path().display(), e))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "olib-location-test-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn same_path_ignores_trailing_separator() {
        assert!(same_path(Path::new("/a/b/"), Path::new("/a/b")));
        assert!(!same_path(Path::new("/a/b"), Path::new("/a/c")));
    }

    #[test]
    fn copy_then_move_keeps_nested_files() {
        let base = temp_dir("move");
        let src = base.join("src");
        std::fs::create_dir_all(src.join("bin/lib")).unwrap();
        std::fs::write(src.join("bin/tool.exe"), b"exe").unwrap();
        std::fs::write(src.join("bin/lib/data.dll"), b"dll").unwrap();

        // 走复制分支（rename 的行为由系统保证，这里验证兜底路径）
        let dst = base.join("dst");
        copy_dir(&src, &dst).unwrap();
        assert_eq!(std::fs::read(dst.join("bin/tool.exe")).unwrap(), b"exe");
        assert_eq!(std::fs::read(dst.join("bin/lib/data.dll")).unwrap(), b"dll");

        let moved = base.join("moved");
        move_dir(&dst, &moved).unwrap();
        assert!(!dst.exists());
        assert!(moved.join("bin/lib/data.dll").is_file());

        let _ = std::fs::remove_dir_all(&base);
    }

    /// 根目录过长时 Calibre 必须被点名，否则用户选了长路径后安装会莫名失败
    /// （路径上限只在 Windows 清单里声明）
    #[cfg(target_os = "windows")]
    #[test]
    fn long_root_warns_about_path_limited_plugin() {
        crate::plugins::init(&std::env::temp_dir().join("olib-location-test-registries"));
        let long = default_root().join("a-very-long-folder-name-that-breaks-calibre");
        assert!(!length_warnings(&long).is_empty());
        assert!(length_warnings(&default_root()).is_empty());
    }
}
