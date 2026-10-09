use crate::config;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub extension: String,
    pub modified: Option<String>,
}

const PATH_ACCESS_DENIED: &str = "Access denied: path is outside download folder";

fn download_root() -> Result<PathBuf, String> {
    let root = PathBuf::from(config::get_config()?.download_folder);
    if !root.exists() {
        return Err("Download folder does not exist".to_string());
    }

    std::fs::canonicalize(&root).map_err(|e| format!("Failed to resolve download folder: {}", e))
}

pub(crate) fn ensure_within_download_root(path: &Path) -> Result<PathBuf, String> {
    let root = download_root()?;
    let canonical =
        std::fs::canonicalize(path).map_err(|e| format!("Failed to resolve path: {}", e))?;

    if !canonical.starts_with(&root) {
        return Err(PATH_ACCESS_DENIED.to_string());
    }

    Ok(canonical)
}

fn validate_new_name(new_name: &str) -> Result<(), String> {
    if new_name.trim().is_empty() {
        return Err("Invalid file name".to_string());
    }

    if new_name.contains('/') || new_name.contains('\\') {
        return Err("Invalid file name".to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn list_files(dir: Option<String>) -> Result<Vec<FileInfo>, String> {
    let path = match dir {
        Some(d) => ensure_within_download_root(Path::new(&d))?,
        None => download_root()?,
    };

    // 目录遍历是复合阻塞操作，整体移入阻塞线程池，避免占住 tokio worker
    tokio::task::spawn_blocking(move || {
        let mut files = Vec::new();
        let entries =
            std::fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let metadata = entry
                .metadata()
                .map_err(|e| format!("Failed to read metadata: {}", e))?;
            let name = entry.file_name().to_string_lossy().to_string();
            let file_path = entry.path().to_string_lossy().to_string();
            let extension = entry
                .path()
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();

            let modified = metadata.modified().ok().map(|t| {
                let datetime: chrono::DateTime<chrono::Local> = t.into();
                datetime.format("%Y-%m-%d %H:%M:%S").to_string()
            });

            files.push(FileInfo {
                name,
                path: file_path,
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                extension,
                modified,
            });
        }

        // Sort: directories first, then by name
        files.sort_by_key(|f| (std::cmp::Reverse(f.is_dir), f.name.to_lowercase()));

        Ok(files)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    let file_path = ensure_within_download_root(Path::new(&path))?;
    // 递归删除可能耗时较长，移入阻塞线程池
    let target = file_path.clone();
    tokio::task::spawn_blocking(move || {
        if target.is_dir() {
            std::fs::remove_dir_all(&target)
        } else {
            std::fs::remove_file(&target)
        }
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
    .map_err(|e| format!("Failed to delete: {}", e))?;

    // 文件没了，相关的加工记录也该清掉，否则书架上会留下指向空气的标记
    let key = file_path.to_string_lossy().to_string();
    if let Err(e) = crate::database::remove_plugin_outputs_for_path(&key) {
        log::warn!("⚠️ Failed to prune plugin outputs for {}: {}", key, e);
    }
    Ok(())
}

#[tauri::command]
pub async fn rename_file(path: String, new_name: String) -> Result<(), String> {
    validate_new_name(&new_name)?;
    let old_path = ensure_within_download_root(Path::new(&path))?;
    let root = download_root()?;
    let new_path = old_path.parent().ok_or("Invalid path")?.join(&new_name);

    if !new_path.starts_with(&root) {
        return Err(PATH_ACCESS_DENIED.to_string());
    }

    tokio::fs::rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("Failed to rename: {}", e))
}

#[tauri::command]
pub async fn open_file(path: String) -> Result<(), String> {
    let file_path = ensure_within_download_root(Path::new(&path))?;
    opener::open(&file_path).map_err(|e| format!("Failed to open file: {}", e))
}

#[tauri::command]
pub async fn open_in_explorer(path: String) -> Result<(), String> {
    let file_path = ensure_within_download_root(Path::new(&path))?;
    let dir = if file_path.is_dir() {
        file_path
    } else {
        file_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or(file_path)
    };

    opener::open(&dir).map_err(|e| format!("Failed to open explorer: {}", e))
}
