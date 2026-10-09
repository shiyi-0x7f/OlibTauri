/// API 客户端与数据模型来自私有 vendor crate `olib_api`。
/// 通过 re-export 薄壳保持 `crate::api::*` 调用路径不变（调用方无需改动）。
pub mod api {
    pub use olib_api::{
        build_reader_url, ping_host, ApiResponse, Book, Pagination, SearchResult, ZLibrary,
    };
}
pub mod commands;
pub mod config;
pub mod cover_proxy;
pub mod database;
pub mod download;
pub mod download_records;
pub mod lan_server;
pub mod plugins;
pub mod tray;
pub mod update_manifest;
pub mod util;
/// 域名管理同样来自私有 vendor crate `olib_api`，保持 `crate::hosts::*` 路径不变。
pub mod hosts {
    pub use olib_api::hosts::*;
}
pub mod weread;

use tauri::{Emitter, Manager};

use commands::{
    auth_commands, book_commands, booklist_commands, bookshelf_commands, config_commands,
    convert_commands, cover_commands, download_commands, favorite_commands, lan_commands,
    ocr_commands, plugin_commands, prescriber_commands, reader_commands, search_commands,
    shortcut_commands, weread_commands,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logger
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, focus the existing window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            log::info!("Blocked second instance launch, focusing existing window");
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            // Auth
            auth_commands::login,
            auth_commands::get_all_users,
            auth_commands::delete_user,
            auth_commands::get_current_user,
            auth_commands::switch_user,
            auth_commands::logout,
            auth_commands::refresh_user_downloads,
            // Search
            search_commands::search_books,
            // Download
            download_commands::download_book,
            download_commands::cancel_download,
            download_commands::get_download_progress,
            download_commands::get_all_downloads,
            download_commands::delete_download,
            download_commands::list_download_records,
            download_commands::delete_download_record,
            // Bookshelf
            bookshelf_commands::list_files,
            bookshelf_commands::delete_file,
            bookshelf_commands::rename_file,
            bookshelf_commands::open_file,
            bookshelf_commands::open_in_explorer,
            // Format conversion
            convert_commands::detect_convert_engine,
            convert_commands::convert_book,
            // OCR
            ocr_commands::ocr_available,
            ocr_commands::ocr_document,
            // Plugins
            plugin_commands::list_plugins,
            plugin_commands::install_plugin,
            plugin_commands::uninstall_plugin,
            plugin_commands::list_plugin_actions,
            plugin_commands::run_plugin_action,
            plugin_commands::get_plugin_tasks,
            plugin_commands::get_plugin_outputs,
            plugin_commands::subscribe_plugin_registry,
            plugin_commands::get_plugins_location,
            plugin_commands::set_plugins_location,
            plugin_commands::open_plugins_location,
            plugin_commands::get_plugins_usage,
            plugin_commands::export_plugin_guide,
            plugin_commands::open_plugin_guide_folder,
            plugin_commands::reload_plugin_registries,
            // Config
            config_commands::get_config,
            config_commands::set_config,
            config_commands::get_hosts,
            config_commands::ping_hosts,
            config_commands::auto_select_fastest_host,
            config_commands::update_subscription,
            config_commands::import_hosts,
            config_commands::reset_hosts,
            config_commands::get_hosts_info,
            config_commands::get_app_version,
            config_commands::check_for_updates,
            // Books
            book_commands::get_popular_books,
            book_commands::get_recent_books,
            book_commands::get_recommended_books,
            book_commands::get_similar_books,
            book_commands::get_book_formats,
            book_commands::get_download_history,
            book_commands::get_book_info,
            // Cover Proxy
            cover_commands::get_cover_proxy_port,
            cover_commands::get_cache_stats,
            cover_commands::clear_cover_cache,
            // Reader
            reader_commands::get_reader_url,
            // Favorites
            favorite_commands::add_favorite,
            favorite_commands::remove_favorite,
            favorite_commands::get_favorites,
            favorite_commands::is_favorite,
            favorite_commands::check_favorites_batch,
            // Booklist share
            booklist_commands::booklist_qr,
            booklist_commands::import_booklist,
            // LAN Server
            lan_commands::start_lan_server,
            lan_commands::stop_lan_server,
            lan_commands::get_lan_status,
            // Shortcuts
            shortcut_commands::update_global_shortcut,
            // WeRead
            weread_commands::weread_status,
            weread_commands::weread_qr_start,
            weread_commands::weread_qr_poll,
            weread_commands::weread_disconnect,
            weread_commands::weread_get_stats,
            weread_commands::weread_get_shelf,
            weread_commands::weread_read_data,
            weread_commands::weread_get_notebooks,
            weread_commands::weread_get_book_info,
            weread_commands::weread_get_chapters,
            weread_commands::weread_get_bookmarks,
            weread_commands::weread_get_my_reviews,
            weread_commands::weread_get_best_bookmarks,
            weread_commands::weread_recommend_next,
            weread_commands::weread_similar_books,
            weread_commands::weread_ai_suggestions,
            weread_commands::weread_ai_ask,
            weread_commands::weread_ai_cancel,
            weread_commands::weread_save_notes,
            weread_commands::weread_import_book,
            // AI 寻书（阅读锦囊）
            prescriber_commands::prescriber_status,
            prescriber_commands::prescriber_start_login,
            prescriber_commands::prescriber_poll_login,
            prescriber_commands::prescriber_logout,
            prescriber_commands::prescriber_diagnose,
        ])
        .setup(|app| {
            // Initialize database
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();
            database::init_db(&app_data_dir).expect("Failed to initialize database");

            // Initialize config
            config::init_config(&app_data_dir).expect("Failed to initialize config");

            // 微信读书扫码会话
            weread::init(&app_data_dir);

            // Load plugin registries (builtin + subscribed third-party)
            plugins::init(&app_data_dir);

            // Start cover proxy server
            let cover_dir = app_data_dir.join("covers");
            tauri::async_runtime::spawn(async move {
                match cover_proxy::start(cover_dir).await {
                    Ok(port) => log::info!("📷 Cover proxy ready on port {}", port),
                    Err(e) => log::error!("Failed to start cover proxy: {}", e),
                }
            });

            // Initialize hosts manager
            hosts::init_hosts(&app_data_dir).expect("Failed to initialize hosts");

            // scc token 滑动续期：剩余 < 48h 时静默换新，失败沿用旧 token
            {
                let h = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    prescriber_commands::renew_token_if_needed(&h).await;
                });
            }


            // Initialize download manager
            download::init();

            // Background: update subscription if configured
            {
                let sub_url = config::get_config()
                    .map(|c| c.subscription_url.clone())
                    .unwrap_or_default();
                if !sub_url.is_empty() {
                    tauri::async_runtime::spawn(async move {
                        match hosts::update_from_subscription(&sub_url).await {
                            Ok(count) => log::info!("📡 Subscription updated: {} hosts", count),
                            Err(e) => {
                                log::warn!("⚠️ Subscription update failed (using cached): {}", e)
                            }
                        }
                    });
                }
            }

            // --- System Tray ---
            tray::setup_tray(app.handle())
                .unwrap_or_else(|e| log::error!("Failed to setup tray: {}", e));

            // --- Window Vibrancy (Mica / Acrylic) ---
            // 平台条件放在外层：否则非 Windows 下 `window` 未使用，CI（Linux）clippy 报错
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                use window_vibrancy::{apply_acrylic, apply_mica};
                if apply_mica(&window, Some(true)).is_err() {
                    let _ = apply_acrylic(&window, Some((18, 18, 18, 200)));
                }
                log::info!("Window vibrancy applied");
            }

            // --- Disable DevTools in production builds ---
            #[cfg(all(not(debug_assertions), target_os = "windows"))]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        unsafe {
                            let controller = webview.controller();
                            if let Ok(core) = controller.CoreWebView2() {
                                if let Ok(settings) = core.Settings() {
                                    // Disable DevTools (F12 / Inspect Element)
                                    let _ = settings.SetAreDevToolsEnabled(false);
                                    // Disable built-in browser context menu
                                    let _ = settings.SetAreDefaultContextMenusEnabled(false);
                                    log::info!(
                                        "🔒 DevTools & context menu disabled (production mode)"
                                    );
                                }
                            }
                        }
                    });
                }
            }

            // --- Global Shortcut: configurable ---
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

                let app_handle = app.handle().clone();
                app.handle()
                    .plugin(
                        tauri_plugin_global_shortcut::Builder::new()
                            .with_handler(move |_app, _shortcut: &Shortcut, event| {
                                if event.state == ShortcutState::Pressed {
                                    if let Some(window) = app_handle.get_webview_window("main") {
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                        let _ = window.emit("toggle-search-palette", true);
                                        log::info!("Global shortcut triggered: search palette");
                                    }
                                }
                            })
                            .build(),
                    )
                    .unwrap_or_else(|e| {
                        log::error!("Failed to init global shortcut plugin: {}", e)
                    });

                // Register the shortcut from config
                let shortcut_str = config::get_value(|c| c.shortcut_search.clone())
                    .unwrap_or_else(|_| "CommandOrControl+Space".to_string());
                let gs_manager = app.global_shortcut();

                // Unregister any leftover shortcuts first (e.g. from a previous instance)
                let _ = gs_manager.unregister_all();

                match shortcut_str.parse::<Shortcut>() {
                    Ok(sc) => {
                        match gs_manager.register(sc) {
                            Ok(_) => log::info!("Global shortcut '{}' registered", shortcut_str),
                            Err(e) => {
                                // Another app (e.g. IME) may hold this hotkey — warn but don't crash
                                log::warn!(
                                    "⚠️ Could not register global shortcut '{}': {}. \
                                     The shortcut may be occupied by another application. \
                                     You can change it in Settings → Shortcuts.",
                                    shortcut_str,
                                    e
                                );
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("Failed to parse shortcut '{}': {:?}", shortcut_str, e);
                    }
                }
            }

            // --- Intercept window close: minimize to tray instead of quitting ---
            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let close_to_tray = config::get_value(|c| c.close_to_tray).unwrap_or(true);
                        if close_to_tray {
                            api.prevent_close();
                            let _ = w.hide();
                        }
                    }
                });
            }

            log::info!("OlibFluent started successfully!");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            // 服务型插件（如 OCR 引擎）是我们拉起的子进程，退出时必须收掉，
            // 否则会作为孤儿进程留在后台占内存
            if let tauri::RunEvent::Exit = event {
                plugins::service::shutdown_all();
            }
        });
}
