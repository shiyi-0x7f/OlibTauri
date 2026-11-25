use crate::cover_proxy;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct CacheStats {
    pub total_size: u64,
    pub file_count: usize,
}

/// Get the cover proxy server port
#[tauri::command]
pub fn get_cover_proxy_port() -> Result<u16, String> {
    let port = cover_proxy::get_port();
    if port == 0 {
        Err("Cover proxy not initialized".to_string())
    } else {
        Ok(port)
    }
}

/// Get cache statistics
#[tauri::command]
pub fn get_cache_stats() -> Result<CacheStats, String> {
    let (total_size, file_count) = cover_proxy::get_cache_stats()?;
    Ok(CacheStats {
        total_size,
        file_count,
    })
}

/// Clear all cached covers
#[tauri::command]
pub fn clear_cover_cache() -> Result<(), String> {
    cover_proxy::clear_cache()
}
