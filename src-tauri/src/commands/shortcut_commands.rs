use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[tauri::command]
pub async fn update_global_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    let gs = app.global_shortcut();

    // Unregister all existing shortcuts
    gs.unregister_all()
        .map_err(|e| format!("Failed to unregister shortcuts: {}", e))?;

    // Parse the shortcut string into a Shortcut struct
    let sc: Shortcut = shortcut
        .parse()
        .map_err(|e| format!("Invalid shortcut '{}': {:?}", shortcut, e))?;

    // Register the new shortcut
    gs.register(sc)
        .map_err(|e| format!("Failed to register shortcut '{}': {}", shortcut, e))?;

    log::info!("Global shortcut updated to: {}", shortcut);
    Ok(())
}
