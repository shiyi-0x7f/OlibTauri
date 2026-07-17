import { invoke } from "@tauri-apps/api/core";
import ShortcutRecorder from "../../components/ShortcutRecorder";
import type { AppConfig } from "./types";

interface ShortcutSectionProps {
    config: AppConfig;
    update: (key: keyof AppConfig, value: any) => void;
    loadConfig: () => Promise<void>;
}

export default function ShortcutSection({ config, update, loadConfig }: ShortcutSectionProps) {
    return (
        <div className="card settings-grid-full">
            <div className="settings-group">
                <div className="settings-group-title">快捷键</div>

                <div className="settings-item">
                    <div className="settings-item-info">
                        <div className="settings-item-title">打开快速搜索</div>
                        <div className="settings-item-desc">全局快捷键，在任何位置按下可打开搜索面板</div>
                    </div>
                    <ShortcutRecorder
                        value={config.shortcut_search || "CommandOrControl+Space"}
                        defaultValue="CommandOrControl+Space"
                        onRecord={async (shortcut) => {
                            try {
                                await invoke("update_global_shortcut", { shortcut });
                                update("shortcut_search", shortcut);
                            } catch (err) {
                                console.error("Failed to update shortcut:", err);
                                // Revert UI on failure
                                loadConfig();
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
