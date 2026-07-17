import { Trash2 } from "lucide-react";
import Toggle from "./Toggle";
import { formatCacheSize } from "./utils";
import type { AppConfig, CacheStats } from "./types";

const STARTUP_PAGES = [
    { path: "/discover", label: "发现" },
    { path: "/", label: "搜索" },
    { path: "/favorites", label: "收藏" },
    { path: "/downloads", label: "下载" },
    { path: "/bookshelf", label: "书架" },
];

interface GeneralSectionProps {
    config: AppConfig;
    update: (key: keyof AppConfig, value: any) => void;
    cacheStats: CacheStats;
    clearing: boolean;
    onClearCache: () => void;
}

export default function GeneralSection({ config, update, cacheStats, clearing, onClearCache }: GeneralSectionProps) {
    return (
        <div className="card">
            <div className="settings-group">
                <div className="settings-group-title">通用</div>

                <div className="settings-item">
                    <div className="settings-item-info">
                        <div className="settings-item-title">启动页面</div>
                        <div className="settings-item-desc">选择应用启动时显示的页面</div>
                    </div>
                    <select
                        className="settings-select"
                        value={config.startup_page || "/discover"}
                        onChange={(e) => update("startup_page", e.target.value)}
                    >
                        {STARTUP_PAGES.map((page) => (
                            <option key={page.path} value={page.path}>
                                {page.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="settings-item">
                    <div className="settings-item-info">
                        <div className="settings-item-title">关闭时最小化到托盘</div>
                        <div className="settings-item-desc">点击关闭按钮时隐藏到系统托盘</div>
                    </div>
                    <Toggle
                        active={config.close_to_tray}
                        onClick={() => update("close_to_tray", !config.close_to_tray)}
                    />
                </div>

                <div className="settings-item">
                    <div className="settings-item-info">
                        <div className="settings-item-title">封面缓存</div>
                        <div className="settings-item-desc">
                            {cacheStats.file_count > 0
                                ? `${cacheStats.file_count} 张封面 · ${formatCacheSize(cacheStats.total_size)}`
                                : "暂无缓存数据"}
                        </div>
                    </div>
                    <button
                        className="btn btn-danger btn-sm"
                        onClick={onClearCache}
                        disabled={clearing || cacheStats.file_count === 0}
                        style={{ flexShrink: 0 }}
                    >
                        {clearing ? (
                            <>清除中...</>
                        ) : (
                            <><Trash2 size={14} /> 清除</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
