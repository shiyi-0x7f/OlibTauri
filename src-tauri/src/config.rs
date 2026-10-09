use crate::util::LockExt;
use log;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Global config
static APP_CONFIG: Mutex<Option<AppConfig>> = Mutex::new(None);
static CONFIG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Application configuration
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    /// Download folder path
    pub download_folder: String,
    /// Cache folder path
    pub cache_folder: String,
    /// Use external browser for downloading
    pub download_with_browser: bool,
    /// Skip duplicate files (true) or rename (false)
    pub skip_duplicate_files: bool,
    /// Active host index (0-3)
    pub host_index: usize,
    /// Search results limit
    pub search_limit: i64,
    /// Language filter index
    pub language_index: usize,
    /// Extension filter index
    pub extension_index: usize,
    /// Exact search mode
    pub exact_search: bool,
    /// Active user email
    pub user_email: String,
    /// Window width
    pub window_width: u32,
    /// Window height
    pub window_height: u32,
    /// Theme mode: "light" or "dark"
    pub theme: String,
    /// Primary color
    pub primary_color: String,
    /// Show system notification when download completes
    #[serde(default = "default_true")]
    pub notify_on_download: bool,
    /// Minimize to system tray on close
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    /// Global shortcut for search palette
    #[serde(default = "default_shortcut_search")]
    pub shortcut_search: String,
    /// Subscription URL for domain list (empty = use built-in defaults)
    #[serde(default)]
    pub subscription_url: String,
    /// Download method: "builtin", "browser", "idm", "motrix", "copy_url"
    #[serde(default)]
    pub download_method: String,
    /// Startup page path: "/discover", "/", "/favorites", "/downloads", "/bookshelf"
    #[serde(default = "default_startup_page")]
    pub startup_page: String,
    /// Calibre ebook-convert 路径（空 = 自动探测常见安装位置与 PATH）
    #[serde(default)]
    pub calibre_path: String,
    /// 插件安装根目录（空 = 默认 %ProgramData%\Olib\plugins）。
    /// 只能经 set_plugins_location 修改——改它要连带迁移已装插件。
    #[serde(default)]
    pub plugins_dir: String,
}

fn default_true() -> bool {
    true
}
fn default_shortcut_search() -> String {
    "CommandOrControl+Space".to_string()
}
fn default_startup_page() -> String {
    "/discover".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        let home = dirs_next().unwrap_or_else(|| PathBuf::from("."));
        Self {
            download_folder: home.join("Downloads").to_string_lossy().to_string(),
            cache_folder: home.join("OlibCache").to_string_lossy().to_string(),
            download_with_browser: false,
            skip_duplicate_files: true,
            host_index: 0,
            search_limit: 50,
            language_index: 0,
            extension_index: 0,
            exact_search: false,
            user_email: String::new(),
            window_width: 1000,
            window_height: 700,
            theme: "dark".to_string(),
            primary_color: "#009faa".to_string(),
            notify_on_download: true,
            close_to_tray: true,
            shortcut_search: default_shortcut_search(),
            subscription_url: String::new(),
            download_method: "builtin".to_string(),
            startup_page: default_startup_page(),
            calibre_path: String::new(),
            plugins_dir: String::new(),
        }
    }
}

fn dirs_next() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Initialize configuration
pub fn init_config(app_data_dir: &Path) -> Result<(), String> {
    let config_path = app_data_dir.join("config.json");

    let config = if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        let default_config = AppConfig::default();
        let json = serde_json::to_string_pretty(&default_config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        fs::write(&config_path, &json).map_err(|e| format!("Failed to write config: {}", e))?;
        default_config
    };

    *CONFIG_PATH.lock_ignore_poison() = Some(config_path);
    *APP_CONFIG.lock_ignore_poison() = Some(config);

    log::info!("Configuration loaded");
    Ok(())
}

/// Get current config
pub fn get_config() -> Result<AppConfig, String> {
    let config = APP_CONFIG.lock_ignore_poison();
    config
        .clone()
        .ok_or_else(|| "Config not initialized".to_string())
}

/// Update and save config
pub fn set_config(new_config: AppConfig) -> Result<(), String> {
    let config_path = CONFIG_PATH.lock_ignore_poison();
    let path = config_path.as_ref().ok_or("Config path not set")?;

    let json = serde_json::to_string_pretty(&new_config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(path, &json).map_err(|e| format!("Failed to write config: {}", e))?;

    *APP_CONFIG.lock_ignore_poison() = Some(new_config);
    Ok(())
}

/// Get a single config value
pub fn get_value<F, T>(getter: F) -> Result<T, String>
where
    F: FnOnce(&AppConfig) -> T,
{
    let config = APP_CONFIG.lock_ignore_poison();
    let cfg = config.as_ref().ok_or("Config not initialized")?;
    Ok(getter(cfg))
}

/// Update a single config value
pub fn update_value<F>(updater: F) -> Result<(), String>
where
    F: FnOnce(&mut AppConfig),
{
    let mut config = get_config()?;
    updater(&mut config);
    set_config(config)
}
