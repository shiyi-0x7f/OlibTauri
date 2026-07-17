import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
    Repeat, Download, Trash2, FileCog, ExternalLink, Puzzle, ScanText,
    CheckCircle2, Loader2, AlertTriangle, RefreshCw, ShieldCheck, Globe, Wand2,
} from "lucide-react";
import toast from "react-hot-toast";

type Phase = "NotInstalled" | "Downloading" | "Verifying" | "Installing" | "Installed" | "Failed";

interface PluginStatus {
    id: string;
    name: string;
    description: string;
    capability: string;
    publisher: string;
    homepage: string;
    license: string;
    origin: "Builtin" | "Remote" | "Local";
    supported: boolean;
    phase: Phase;
    progress: number;
    downloaded_bytes: number;
    total_bytes: number;
    speed_kbps: number;
    source: string;
    engine_path: string;
    error?: string;
    outputs: string[];
    inputs: string[];
}

interface EngineInfo {
    available: boolean;
    path: string;
    version: string;
}

/** 插件清单里声明的一键动作，卡片上列出来让用户知道装了能干什么 */
interface PluginAction {
    plugin_id: string;
    action_id: string;
    name: string;
    description: string;
}

function formatMB(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function formatSpeed(kbps: number): string {
    if (kbps <= 0) return "";
    return kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${kbps.toFixed(0)} KB/s`;
}

const CAPABILITY_ICONS: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
    convert: Repeat,
    ocr: ScanText,
    "pdf-tools": Wand2,
};

export default function PluginsPage() {
    const [plugins, setPlugins] = useState<PluginStatus[]>([]);
    const [actions, setActions] = useState<PluginAction[]>([]);
    const [engine, setEngine] = useState<EngineInfo | null>(null);
    const [calibrePath, setCalibrePath] = useState("");
    const [loading, setLoading] = useState(true);
    const [subscribing, setSubscribing] = useState(false);
    // WebView2 不实现 window.prompt()，输入框只能自己做
    const [showAddSource, setShowAddSource] = useState(false);
    const [sourceUrl, setSourceUrl] = useState("");

    const refresh = useCallback(async () => {
        try {
            const [list, acts, info, cfg] = await Promise.all([
                invoke<PluginStatus[]>("list_plugins"),
                invoke<PluginAction[]>("list_plugin_actions"),
                invoke<EngineInfo>("detect_convert_engine"),
                invoke<{ calibre_path: string }>("get_config"),
            ]);
            setPlugins(list);
            setActions(acts);
            setEngine(info);
            setCalibrePath(cfg.calibre_path || "");
        } catch (err) {
            console.error("Failed to load plugins:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // 有插件在下载/安装时轮询进度
    const busy = plugins.some(p =>
        p.phase === "Downloading" || p.phase === "Verifying" || p.phase === "Installing"
    );
    useEffect(() => {
        if (!busy) return;
        const interval = setInterval(refresh, 800);
        return () => clearInterval(interval);
    }, [busy, refresh]);

    const handleInstall = async (id: string) => {
        try {
            await invoke("install_plugin", { id });
            refresh();
        } catch (err) {
            toast.error(String(err), { duration: 5000 });
        }
    };

    const handleUninstall = async (p: PluginStatus) => {
        const confirmed = await confirm(`卸载「${p.name}」后相关功能将不可用，需要时可重新下载。确定卸载吗？`, {
            title: "卸载插件",
            kind: "warning",
            okLabel: "卸载",
            cancelLabel: "取消",
        });
        if (!confirmed) return;
        try {
            await invoke("uninstall_plugin", { id: p.id });
            toast.success(`${p.name} 已卸载`);
            refresh();
        } catch (err) {
            toast.error(String(err), { duration: 5000 });
        }
    };

    const setCalibre = async (path: string) => {
        try {
            const cfg: any = await invoke("get_config");
            await invoke("set_config", { newConfig: { ...cfg, calibre_path: path } });
            refresh();
        } catch (err) {
            toast.error(String(err), { duration: 5000 });
        }
    };

    const handleSubscribe = async () => {
        const url = sourceUrl.trim();
        if (!url) return;
        setSubscribing(true);
        try {
            const count: number = await invoke("subscribe_plugin_registry", { url });
            toast.success(`已添加插件源，发现 ${count} 个插件`);
            setShowAddSource(false);
            setSourceUrl("");
            refresh();
        } catch (err) {
            toast.error(String(err), { duration: 8000 });
        } finally {
            setSubscribing(false);
        }
    };

    /** 转换引擎特有：用户可能自行装了 Calibre，此时无需插件 */
    const externalEngine = (p: PluginStatus) =>
        p.capability === "convert" && p.phase !== "Installed" && engine?.available;

    const renderCard = (p: PluginStatus) => {
        const Icon = CAPABILITY_ICONS[p.capability] || Puzzle;
        const installing = p.phase === "Downloading" || p.phase === "Verifying" || p.phase === "Installing";
        const external = externalEngine(p);
        const installed = p.phase === "Installed";
        const ownActions = actions.filter(a => a.plugin_id === p.id);

        return (
            <div className="card" key={p.id} style={{ padding: 20, marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: "var(--radius-md)", flexShrink: 0,
                        background: "linear-gradient(135deg, rgba(var(--accent-rgb),0.2), rgba(var(--accent-rgb),0.1))",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <Icon size={22} style={{ color: "var(--accent)" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
                                {p.name}
                            </span>
                            {installing ? (
                                <span className="badge" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <Loader2 size={11} className="spinner" />
                                    {p.phase === "Installing" ? "安装中" : p.phase === "Verifying" ? "校验中" : "下载中"}
                                </span>
                            ) : (installed || external) ? (
                                <span className="badge" style={{
                                    display: "flex", alignItems: "center", gap: 4,
                                    background: "rgba(34, 197, 94, 0.15)", color: "#22c55e",
                                }}>
                                    <CheckCircle2 size={11} /> 已安装
                                </span>
                            ) : (
                                <span className="badge">未安装</span>
                            )}
                            {p.origin === "Builtin" ? (
                                <span className="badge" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11 }}>
                                    <ShieldCheck size={10} /> 官方
                                </span>
                            ) : (
                                <span className="badge" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11 }}>
                                    <Globe size={10} /> 第三方
                                </span>
                            )}
                        </div>
                        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                            {p.description}
                        </div>
                        {/* 装了能干什么：把清单声明的动作直接列出来 */}
                        {ownActions.length > 0 && (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                                {ownActions.map(a => (
                                    <span
                                        key={a.action_id}
                                        className="badge"
                                        title={a.description}
                                        style={{ display: "flex", alignItems: "center", gap: 3 }}
                                    >
                                        <Wand2 size={10} /> {a.name}
                                    </span>
                                ))}
                            </div>
                        )}
                        {(p.publisher || p.license) && (
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                                {[p.publisher, p.license].filter(Boolean).join(" · ")}
                            </div>
                        )}
                    </div>
                </div>

                {installing ? (
                    <>
                        <div className="progress-bar" style={{ marginBottom: 8 }}>
                            <div
                                className="progress-fill"
                                style={{ width: p.phase === "Downloading" ? `${p.progress}%` : "100%" }}
                            />
                        </div>
                        <div style={{
                            display: "flex", justifyContent: "space-between", gap: 8,
                            fontSize: 12, color: "var(--text-muted)",
                        }}>
                            <span>
                                {p.phase === "Installing" ? "正在解压安装…"
                                    : p.phase === "Verifying" ? "正在校验完整性…"
                                        : `${formatMB(p.downloaded_bytes)}${p.total_bytes > 0 ? ` / ${formatMB(p.total_bytes)}` : ""}`}
                            </span>
                            {p.phase === "Downloading" && p.source && (
                                <span style={{ flexShrink: 0 }}>
                                    {p.source}{formatSpeed(p.speed_kbps) && ` · ${formatSpeed(p.speed_kbps)}`}
                                </span>
                            )}
                        </div>
                    </>
                ) : (
                    <>
                        {p.phase === "Failed" && p.error && (
                            <div style={{
                                display: "flex", gap: 8, padding: 10, marginBottom: 12,
                                background: "rgba(239, 68, 68, 0.08)",
                                border: "1px solid rgba(239, 68, 68, 0.25)",
                                borderRadius: "var(--radius-md)",
                                fontSize: 12, color: "var(--text-secondary)",
                            }}>
                                <AlertTriangle size={15} color="var(--error)" style={{ flexShrink: 0, marginTop: 1 }} />
                                <span style={{ wordBreak: "break-all" }}>{p.error}</span>
                            </div>
                        )}

                        {(installed || external) && (
                            <div style={{ fontSize: 12, color: "var(--text-muted)", wordBreak: "break-all", marginBottom: 12 }}>
                                {installed ? p.engine_path : (
                                    <>
                                        {engine?.version || "已检测到系统安装的引擎"}
                                        <br />{engine?.path}
                                        <div style={{ marginTop: 6, color: "var(--text-secondary)" }}>
                                            检测到你已自行安装，直接使用，无需下载插件。
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {!installed && !external && (
                            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.6 }}>
                                {p.supported
                                    ? "首次使用需下载，之后离线可用。优先走国内加速源，慢或失败会自动换源。"
                                    : "当前系统不支持一键安装，请自行安装对应工具，安装后会被自动检测。"}
                            </div>
                        )}

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {!installed && p.supported && (
                                <button
                                    className={external ? "btn btn-secondary btn-sm" : "btn btn-primary btn-sm"}
                                    onClick={() => handleInstall(p.id)}
                                >
                                    <Download size={14} />
                                    {p.phase === "Failed" ? "重试下载" : external ? "仍然下载插件" : "下载安装"}
                                </button>
                            )}
                            {installed && (
                                <button className="btn btn-secondary btn-sm" onClick={() => handleUninstall(p)}>
                                    <Trash2 size={14} /> 卸载
                                </button>
                            )}
                            {p.capability === "convert" && (
                                <>
                                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                                        const selected = await open({ title: "选择 ebook-convert 可执行文件" });
                                        if (selected) setCalibre(selected as string);
                                    }}>
                                        <FileCog size={14} /> 指定已有路径
                                    </button>
                                    {calibrePath && (
                                        <button className="btn btn-secondary btn-sm" onClick={() => setCalibre("")}>
                                            恢复自动检测
                                        </button>
                                    )}
                                </>
                            )}
                            {p.homepage && (
                                <button className="btn btn-secondary btn-sm" onClick={() => openUrl(p.homepage)}>
                                    <ExternalLink size={13} /> 项目主页
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        );
    };

    return (
        <div className="page-container">
            <div className="page-header flex items-center justify-between">
                <div>
                    <h1 className="page-title">插件</h1>
                    <p className="page-subtitle">按需安装扩展能力，不用则不占空间</p>
                </div>
                <div className="flex gap-2">
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowAddSource(true)}>
                        <Globe size={14} /> 添加插件源
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={refresh}>
                        <RefreshCw size={14} /> 刷新
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="empty-state" style={{ padding: 40 }}>
                    <RefreshCw size={24} className="spinner" />
                </div>
            ) : plugins.length === 0 ? (
                <div className="empty-state" style={{ padding: 40 }}>
                    <Puzzle size={36} className="empty-state-icon" />
                    <p className="empty-state-text">没有可用插件</p>
                </div>
            ) : (
                <div style={{ maxWidth: 660 }}>
                    {plugins.map(renderCard)}
                    <div style={{
                        fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7,
                        padding: "12px 4px",
                    }}>
                        插件由外部开源工具提供，均为本地运行、不上传文件。第三方插件必须提供
                        sha256 校验和，安装前会逐字节校验，与官方发布的安装包不符则拒绝安装。
                    </div>
                </div>
            )}

            {/* 添加第三方插件源 */}
            {showAddSource && (
                <div className="modal-overlay" onClick={() => setShowAddSource(false)}>
                    <div
                        className="modal"
                        onClick={(e) => e.stopPropagation()}
                        style={{ minWidth: 440, maxWidth: 500 }}
                    >
                        <div className="modal-title" style={{ fontSize: 17, marginBottom: 6 }}>
                            添加插件源
                        </div>
                        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 14 }}>
                            填入第三方插件源的 registry JSON 地址（必须是 https）。
                            源里的每个插件都必须提供 sha256 校验和，否则整个源会被拒绝。
                        </div>
                        <input
                            className="input"
                            autoFocus
                            placeholder="https://example.com/olib-plugins.json"
                            value={sourceUrl}
                            onChange={(e) => setSourceUrl(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSubscribe()}
                            style={{ width: "100%", marginBottom: 16 }}
                        />
                        <div style={{
                            display: "flex", gap: 8, padding: 10, marginBottom: 16,
                            background: "rgba(245, 158, 11, 0.1)",
                            border: "1px solid rgba(245, 158, 11, 0.25)",
                            borderRadius: "var(--radius-md)",
                            fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6,
                        }}>
                            <AlertTriangle size={15} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
                            <span>第三方插件会在你的电脑上运行外部程序，请只添加你信任的来源。</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => setShowAddSource(false)}>
                                取消
                            </button>
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={handleSubscribe}
                                disabled={!sourceUrl.trim() || subscribing}
                            >
                                {subscribing ? <Loader2 size={14} className="spinner" /> : <Globe size={14} />}
                                添加
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
