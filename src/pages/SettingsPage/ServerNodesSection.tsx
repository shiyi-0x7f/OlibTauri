import { useState } from "react";
import { Check, Zap, RotateCcw, Globe, Upload, RotateCw } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import { getLatencyColor, getLatencyText } from "./utils";
import type { AppConfig, HostLatency, HostsInfo } from "./types";

interface ServerNodesSectionProps {
    config: AppConfig;
    update: (key: keyof AppConfig, value: any) => void;
    hostLatencies: HostLatency[];
    pinging: boolean;
    pingHosts: () => void;
    hasActiveDownloads: boolean;
    hostsInfo: HostsInfo | null;
    subUrl: string;
    setSubUrl: (url: string) => void;
    updatingSub: boolean;
    autoSelecting: boolean;
    onUpdateSubscription: () => void;
    onImportHosts: (text: string) => void;
    onResetHosts: () => void;
    onAutoSelect: () => void;
}

export default function ServerNodesSection({
    config,
    update,
    hostLatencies,
    pinging,
    pingHosts,
    hasActiveDownloads,
    hostsInfo,
    subUrl,
    setSubUrl,
    updatingSub,
    autoSelecting,
    onUpdateSubscription,
    onImportHosts,
    onResetHosts,
    onAutoSelect,
}: ServerNodesSectionProps) {
    const { primaryColor } = useTheme();
    const [showImport, setShowImport] = useState(false);
    const [importText, setImportText] = useState("");

    return (
        <div className="card settings-grid-full">
            <div className="settings-group">
                <div className="settings-group-title">服务器节点</div>

                <div className="settings-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div className="settings-item-info" style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                            <div className="settings-item-title">选择节点</div>
                            <div className="settings-item-desc">
                                已选: 节点 {(config.host_index || 0) + 1}
                                {hostLatencies.length > 0 && (() => { const h = hostLatencies.find(h => h.index === config.host_index); return h && h.latency_ms > 0 ? ` · ${h.latency_ms}ms` : ""; })()}
                                {hostsInfo && <span style={{ opacity: 0.6 }}> · 共 {hostsInfo.hosts.length} 个</span>}
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={onAutoSelect}
                                disabled={autoSelecting || pinging}
                                title="测速并自动选择最快节点"
                            >
                                <Zap size={13} className={autoSelecting ? "spin" : ""} /> {autoSelecting ? "选择中..." : "自动选最快"}
                            </button>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={pingHosts}
                                disabled={pinging}
                            >
                                <RotateCcw size={13} className={pinging ? "spin" : ""} /> {pinging ? "测速中" : "测速"}
                            </button>
                        </div>
                    </div>

                    {/* Node grid — compact, scrollable */}
                    <div style={{
                        maxHeight: "94px",
                        overflowY: "auto",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border)",
                        padding: "6px",
                    }}>
                        <div style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
                            gap: "4px",
                        }}>
                            {hostLatencies.length === 0 && pinging && (
                                Array.from({ length: 12 }).map((_, i) => (
                                    <div key={i} style={{
                                        padding: "6px 4px",
                                        borderRadius: "6px",
                                        background: "var(--bg-tertiary)",
                                        textAlign: "center",
                                        opacity: 0.4,
                                    }}>
                                        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>节点 {i + 1}</div>
                                        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: 1 }}>···</div>
                                    </div>
                                ))
                            )}
                            {hostLatencies.map((host) => {
                                const isSelected = config.host_index === host.index;
                                const color = getLatencyColor(host.latency_ms);
                                return (
                                    <div
                                        key={host.index}
                                        onClick={() => {
                                            if (hasActiveDownloads) return;
                                            update("host_index", host.index);
                                        }}
                                        title={hasActiveDownloads ? "下载进行中，无法切换节点" : `节点 ${host.index + 1}`}
                                        style={{
                                            padding: "6px 4px",
                                            borderRadius: "6px",
                                            border: `1.5px solid ${isSelected ? color : "transparent"}`,
                                            background: isSelected
                                                ? `linear-gradient(135deg, ${color}15, ${color}08)`
                                                : "var(--bg-tertiary)",
                                            cursor: hasActiveDownloads ? "not-allowed" : "pointer",
                                            opacity: hasActiveDownloads && !isSelected ? 0.4 : 1,
                                            transition: "all 0.15s ease",
                                            textAlign: "center",
                                            position: "relative",
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!hasActiveDownloads) e.currentTarget.style.background = isSelected ? `linear-gradient(135deg, ${color}20, ${color}10)` : "var(--bg-hover)";
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = isSelected ? `linear-gradient(135deg, ${color}15, ${color}08)` : "var(--bg-tertiary)";
                                        }}
                                    >
                                        <div style={{
                                            fontSize: "11px",
                                            fontWeight: isSelected ? 600 : 400,
                                            color: isSelected ? color : "var(--text-secondary)",
                                            lineHeight: 1,
                                        }}>
                                            节点 {host.index + 1}
                                        </div>
                                        <div style={{
                                            fontSize: "10px",
                                            fontWeight: 600,
                                            color: color,
                                            marginTop: "2px",
                                            fontVariantNumeric: "tabular-nums",
                                            lineHeight: 1,
                                        }}>
                                            {getLatencyText(host.latency_ms)}
                                        </div>
                                        {isSelected && (
                                            <div style={{
                                                position: "absolute",
                                                top: "2px",
                                                right: "2px",
                                                width: "12px",
                                                height: "12px",
                                                borderRadius: "50%",
                                                background: color,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                            }}>
                                                <Check size={7} color="white" />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Advanced: Subscription / Import — collapsed by default */}
                <div style={{ marginTop: "12px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
                    <div
                        onClick={() => setShowImport(!showImport)}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 500,
                            color: "var(--text-muted)",
                            userSelect: "none",
                        }}
                    >
                        <span style={{
                            display: "inline-block",
                            transform: showImport ? "rotate(90deg)" : "rotate(0deg)",
                            transition: "transform 0.2s ease",
                            fontSize: "10px",
                        }}>▶</span>
                        高级选项 · 订阅 / 导入节点
                        {hostsInfo && hostsInfo.source !== "builtin" && (
                            <span style={{
                                fontSize: "10px",
                                padding: "1px 6px",
                                borderRadius: "10px",
                                background: `${primaryColor}15`,
                                color: primaryColor,
                                fontWeight: 600,
                            }}>
                                {{"subscription": "已订阅", "manual": "已导入"}[hostsInfo.source] || hostsInfo.source}
                            </span>
                        )}
                    </div>

                    {showImport && (
                        <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                            {/* Info */}
                            <div className="settings-item-desc" style={{ margin: 0 }}>
                                来源: {{"builtin": "内置默认", "subscription": "订阅", "manual": "手动导入"}[hostsInfo?.source || "builtin"] || "内置默认"}
                                {hostsInfo?.updated_at && ` · 更新于 ${new Date(hostsInfo.updated_at).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                            </div>

                            {/* Subscription URL */}
                            <div style={{ display: "flex", gap: "8px" }}>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="粘贴订阅链接，如 https://..."
                                    value={subUrl}
                                    onChange={(e) => setSubUrl(e.target.value)}
                                    style={{ flex: 1, fontSize: "13px" }}
                                />
                                <button
                                    className="btn btn-primary btn-sm"
                                    disabled={!subUrl.trim() || updatingSub}
                                    onClick={onUpdateSubscription}
                                    style={{ flexShrink: 0 }}
                                >
                                    <Globe size={13} className={updatingSub ? "spin" : ""} /> {updatingSub ? "更新中..." : "更新订阅"}
                                </button>
                            </div>

                            {/* Paste / Import */}
                            <textarea
                                className="input"
                                placeholder={"手动粘贴域名列表（每行一个域名或 JSON 格式）"}
                                value={importText}
                                onChange={(e) => setImportText(e.target.value)}
                                rows={3}
                                style={{ width: "100%", fontSize: "12px", resize: "vertical", fontFamily: "monospace" }}
                            />

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                {hostsInfo?.source !== "builtin" ? (
                                    <button className="btn btn-secondary btn-sm" onClick={onResetHosts}>
                                        <RotateCw size={12} /> 重置为默认节点
                                    </button>
                                ) : <div />}
                                <button className="btn btn-primary btn-sm" disabled={!importText.trim()} onClick={() => {
                                    onImportHosts(importText.trim());
                                    setImportText("");
                                }}>
                                    <Upload size={13} /> 导入节点
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
