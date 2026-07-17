import { FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import Toggle from "./Toggle";
import type { AppConfig } from "./types";

interface DownloadSectionProps {
    config: AppConfig;
    update: (key: keyof AppConfig, value: any) => void;
}

export default function DownloadSection({ config, update }: DownloadSectionProps) {
    // UI-only setting for download sound
    const downloadSound = localStorage.getItem("olib-download-sound") || "notification_message-notify-8-313753.mp3";

    const handleSoundChange = (value: string) => {
        localStorage.setItem("olib-download-sound", value);
        if (value !== 'none') {
            const audio = new Audio(`/src/assets/sounds/${value}`);
            audio.volume = 0.5;
            audio.play().catch(() => {});
        }
    };

    return (
        <div className="card">
            <div className="settings-group">
                <div className="settings-group-title">下载设置</div>

                <div className="settings-item">
                    <div className="settings-item-info">
                        <div className="settings-item-title">下载文件夹</div>
                        <div className="settings-item-desc" style={{ wordBreak: "break-all" }}>{config.download_folder}</div>
                    </div>
                    <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0, marginLeft: 8 }} onClick={async () => {
                        const selected = await open({ directory: true, title: "选择下载文件夹" });
                        if (selected) {
                            update("download_folder", selected);
                        }
                    }}>
                        <FolderOpen size={14} /> 选择
                    </button>
                </div>

                <div className="settings-item">
                    <div className="settings-item-info">
                        <div className="settings-item-title">跳过重复文件</div>
                        <div className="settings-item-desc">如果文件已存在则跳过下载</div>
                    </div>
                    <Toggle
                        active={config.skip_duplicate_files}
                        onClick={() => update("skip_duplicate_files", !config.skip_duplicate_files)}
                    />
                </div>

                <div className="settings-item">
                    <div className="settings-item-info">
                        <div className="settings-item-title">下载方式</div>
                        <div className="settings-item-desc">
                            {(() => {
                                const method = config.download_method || "builtin";
                                const hints: Record<string, string> = {
                                    builtin: "使用内置 aria2c 引擎下载，支持多线程加速",
                                    browser: "使用默认浏览器打开下载链接",
                                    idm: "发送到 Internet Download Manager 下载",
                                    motrix: "发送到 Motrix 下载（需先启动 Motrix）",
                                    copy_url: "仅复制下载链接到剪贴板",
                                };
                                return hints[method] || hints.builtin;
                            })()}
                        </div>
                    </div>
                    <select
                        className="select"
                        value={config.download_method || "builtin"}
                        onChange={(e) => update("download_method", e.target.value)}
                        style={{ minWidth: "140px" }}
                    >
                        <option value="builtin">内置下载</option>
                        <option value="browser">浏览器</option>
                        <option value="idm">IDM</option>
                        <option value="motrix">Motrix</option>
                        <option value="copy_url">复制链接</option>
                    </select>
                </div>

                <div className="settings-item">
                    <div className="settings-item-info">
                        <div className="settings-item-title">下载完成通知</div>
                        <div className="settings-item-desc">下载完成或失败时显示系统通知</div>
                    </div>
                    <Toggle
                        active={config.notify_on_download}
                        onClick={() => update("notify_on_download", !config.notify_on_download)}
                    />
                </div>

                <div className="settings-item">
                    <div className="settings-item-info">
                        <div className="settings-item-title">下载提示音</div>
                        <div className="settings-item-desc">下载完成时的音效</div>
                    </div>
                    <select
                        className="select"
                        defaultValue={downloadSound}
                        onChange={(e) => handleSoundChange(e.target.value)}
                    >
                        <option value="notification_message-notify-8-313753.mp3">默认 (Notify 8)</option>
                        <option value="soundreality-notification-bingo-498938.mp3">清脆 (Bingo)</option>
                        <option value="universfield-bright-notification-352449.mp3">明亮 (Bright)</option>
                        <option value="universfield-new-notification-025-380251.mp3">短促 1 (New 025)</option>
                        <option value="universfield-new-notification-026-380249.mp3">短促 2 (New 026)</option>
                        <option value="universfield-new-notification-034-485901.mp3">灵动 (New 034)</option>
                        <option value="none">静音 (Mute)</option>
                    </select>
                </div>
            </div>
        </div>
    );
}
