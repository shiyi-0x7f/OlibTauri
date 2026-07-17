import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Repeat, Loader2, Puzzle } from "lucide-react";
import toast from "react-hot-toast";

interface EngineInfo {
    available: boolean;
    path: string;
    version: string;
    /** 目标格式来自插件清单，不再在前端硬编码 */
    outputs: string[];
    inputs: string[];
}

interface PluginStatus {
    capability: string;
    phase: "NotInstalled" | "Downloading" | "Verifying" | "Installing" | "Installed" | "Failed";
}

interface ConvertDialogProps {
    fileName: string;
    filePath: string;
    extension: string;
    onClose: () => void;
    /** 转换任务已成功启动 */
    onStarted: () => void;
}

export default function ConvertDialog({ fileName, filePath, extension, onClose, onStarted }: ConvertDialogProps) {
    const navigate = useNavigate();
    const [engine, setEngine] = useState<EngineInfo | null>(null);
    const [pluginBusy, setPluginBusy] = useState(false);
    const [detecting, setDetecting] = useState(true);
    const [target, setTarget] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);

    const options = (engine?.outputs ?? [])
        .map(f => f.toUpperCase())
        .filter(f => f !== extension.toUpperCase());

    const detect = useCallback(async () => {
        try {
            const info: EngineInfo = await invoke("detect_convert_engine");
            setEngine(info);
            if (!info.available) {
                const list: PluginStatus[] = await invoke("list_plugins");
                const convert = list.find(p => p.capability === "convert");
                setPluginBusy(
                    convert?.phase === "Downloading" ||
                    convert?.phase === "Verifying" ||
                    convert?.phase === "Installing"
                );
            }
        } catch (err) {
            console.error("Failed to detect convert engine:", err);
        } finally {
            setDetecting(false);
        }
    }, []);

    useEffect(() => {
        detect();
    }, [detect]);

    const handleGoToPlugins = () => {
        onClose();
        navigate("/plugins");
    };

    const handleStart = async () => {
        if (!target || starting) return;
        setStarting(true);
        try {
            await invoke("convert_book", { inputPath: filePath, targetFormat: target.toLowerCase() });
            toast(`已开始转换为 ${target}`, { icon: "🔄", duration: 3000 });
            onStarted();
            onClose();
        } catch (err) {
            console.error("Failed to start conversion:", err);
            toast.error(String(err), { duration: 5000 });
            setStarting(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                style={{ minWidth: 400, maxWidth: 440 }}
            >
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                    <div style={{
                        width: 40, height: 40, borderRadius: "var(--radius-md)",
                        background: "linear-gradient(135deg, rgba(var(--accent-rgb),0.2), rgba(var(--accent-rgb),0.1))",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <Repeat size={20} style={{ color: "var(--accent)" }} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div className="modal-title" style={{ margin: 0, fontSize: 17 }}>
                            转换格式
                        </div>
                        <div className="truncate" style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }} title={fileName}>
                            {fileName}
                        </div>
                    </div>
                </div>

                {detecting ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 0", color: "var(--text-muted)", fontSize: 13 }}>
                        <Loader2 size={16} className="spinner" /> 正在检测转换引擎…
                    </div>
                ) : !engine?.available ? (
                    /* 引擎未就绪：引导去插件页，安装与进度都在那里管理 */
                    <div style={{
                        display: "flex", gap: 10, padding: 14, marginBottom: 16,
                        background: "rgba(var(--accent-rgb), 0.08)",
                        border: "1px solid rgba(var(--accent-rgb), 0.2)",
                        borderRadius: "var(--radius-md)",
                    }}>
                        <Puzzle size={18} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }} />
                        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                            {pluginBusy
                                ? "格式转换引擎正在安装中，去插件页查看进度。"
                                : "格式转换需要先安装「格式转换引擎」插件，安装后即可使用。"}
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Target format chips */}
                        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
                            选择目标格式：
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                            {options.map(fmt => (
                                <button
                                    key={fmt}
                                    className={`filter-chip ${target === fmt ? "filter-chip-active" : ""}`}
                                    onClick={() => setTarget(fmt)}
                                >
                                    {fmt}
                                </button>
                            ))}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
                            由 {engine.version || "Calibre ebook-convert"} 本地转换，转换结果保存在同一文件夹。
                        </div>
                    </>
                )}

                {/* Actions */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button className="btn btn-secondary btn-sm" onClick={onClose}>
                        取消
                    </button>
                    {!detecting && !engine?.available && (
                        <button className="btn btn-primary btn-sm" onClick={handleGoToPlugins}>
                            <Puzzle size={14} />
                            {pluginBusy ? "查看进度" : "前往安装"}
                        </button>
                    )}
                    {engine?.available && (
                        <button
                            className="btn btn-primary btn-sm"
                            disabled={!target || starting}
                            onClick={handleStart}
                        >
                            {starting ? <Loader2 size={14} className="spinner" /> : <Repeat size={14} />}
                            开始转换
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
