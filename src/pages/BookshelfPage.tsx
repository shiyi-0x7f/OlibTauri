import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
    FileText, Folder, Trash2, ExternalLink,
    FolderOpen, RefreshCw, Wifi, WifiOff,
    BookOpen, Image, Film, Package, Repeat, ScanText,
    CheckCircle2, Sparkles, Wand2,
} from "lucide-react";
import toast from "react-hot-toast";
import ContextMenu, { ContextMenuItem } from "../components/ContextMenu";
import WirelessTransfer from "../components/WirelessTransfer";
import ConvertDialog from "../components/ConvertDialog";

interface FileInfo {
    name: string;
    path: string;
    is_dir: boolean;
    size: number;
    extension: string;
    modified?: string;
}

interface ConvertTask {
    id: string;
    plugin_id: string;
    input_path: string;
    output_path: string;
    file_name: string;
    target_format: string;
    progress: number;
    status: "Running" | "Success" | "Failed";
    error?: string;
}

interface EngineInfo {
    available: boolean;
    /** 可作为转换输入的格式，来自插件清单 */
    inputs: string[];
}

interface PluginInfo {
    id: string;
    capability: string;
    inputs: string[];
}

/** 插件清单里声明的一键动作（瘦身、解锁…），右键菜单据此自动生成 */
interface PluginAction {
    plugin_id: string;
    plugin_name: string;
    action_id: string;
    name: string;
    description: string;
    inputs: string[];
    installed: boolean;
}

/** 一条持久化的加工记录：某文件被转换/识别过，产出了什么 */
interface PluginOutput {
    output_path: string;
    source_path: string;
    source_name: string;
    output_name: string;
    plugin_id: string;
    capability: string;
    target_format?: string;
    created_at?: string;
}

function formatSize(bytes: number): string {
    if (!bytes) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
    }
    return `${size.toFixed(1)} ${units[i]}`;
}

function getFileIconClass(ext: string): string {
    switch (ext.toLowerCase()) {
        case "pdf": return "pdf";
        case "epub": return "epub";
        case "mobi":
        case "azw3": return "mobi";
        default: return "default";
    }
}

export default function BookshelfPage() {
    const navigate = useNavigate();
    const [files, setFiles] = useState<FileInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeFilter, setActiveFilter] = useState<string>("全部");
    const [activeSubFilter, setActiveSubFilter] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileInfo } | null>(null);
    const [showWireless, setShowWireless] = useState(false);
    const [lanRunning, setLanRunning] = useState(false);
    const [convertFile, setConvertFile] = useState<FileInfo | null>(null);
    const [conversions, setConversions] = useState<ConvertTask[]>([]);
    const [convertibleInputs, setConvertibleInputs] = useState<Set<string>>(new Set());
    const [ocrInputs, setOcrInputs] = useState<Set<string>>(new Set());
    const [ocrPluginId, setOcrPluginId] = useState<string>("");
    const [outputs, setOutputs] = useState<PluginOutput[]>([]);
    const [actions, setActions] = useState<PluginAction[]>([]);

    // Poll LAN server status
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const s: { running: boolean } = await invoke("get_lan_status");
                setLanRunning(s.running);
            } catch { /* ignore */ }
        };
        checkStatus();
        const interval = setInterval(checkStatus, 3000);
        return () => clearInterval(interval);
    }, []);

    // Category definitions for grouping file types
    const CATEGORIES: Record<string, { exts: Set<string>; icon: string }> = useMemo(() => ({
        "电子书": { exts: new Set(["PDF", "EPUB", "MOBI", "AZW3", "AZW", "FB2", "DJVU", "CBZ", "CBR"]), icon: "book" },
        "文档":   { exts: new Set(["DOC", "DOCX", "PPT", "PPTX", "XLS", "XLSX", "CSV", "TXT", "MD", "RTF", "ODT", "ODS", "ODP"]), icon: "doc" },
        "图片":   { exts: new Set(["JPG", "JPEG", "PNG", "GIF", "BMP", "SVG", "WEBP", "AVIF", "TIFF", "TIF", "ICO", "PSD", "EPS"]), icon: "image" },
        "音视频": { exts: new Set(["MP4", "MP3", "AVI", "MKV", "MOV", "WAV", "FLAC", "AAC", "OGG", "WMV", "WEBM", "M4A", "M4V"]), icon: "media" },
    }), []);

    // Compute category-based filter options with counts
    const filterOptions = useMemo(() => {
        const categoryCounts: Record<string, number> = {};
        let folderCount = 0;
        let otherCount = 0;

        for (const f of files) {
            if (f.is_dir) {
                folderCount++;
                continue;
            }
            if (!f.extension) { otherCount++; continue; }
            const ext = f.extension.toUpperCase();
            let matched = false;
            for (const [cat, { exts }] of Object.entries(CATEGORIES)) {
                if (exts.has(ext)) {
                    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
                    matched = true;
                    break;
                }
            }
            if (!matched) otherCount++;
        }

        const opts: { label: string; count: number }[] = [
            { label: "全部", count: files.length },
        ];
        if (folderCount > 0) opts.push({ label: "文件夹", count: folderCount });
        for (const cat of Object.keys(CATEGORIES)) {
            if (categoryCounts[cat]) opts.push({ label: cat, count: categoryCounts[cat] });
        }
        if (otherCount > 0) opts.push({ label: "其他", count: otherCount });
        return opts;
    }, [files, CATEGORIES]);

    // Reset filter if the active option no longer exists
    useEffect(() => {
        if (activeFilter !== "全部" && !filterOptions.some(o => o.label === activeFilter)) {
            setActiveFilter("全部");
            setActiveSubFilter(null);
        }
    }, [filterOptions, activeFilter]);

    // Clear sub-filter when switching categories
    const handleCategoryClick = useCallback((label: string) => {
        if (activeFilter === label) {
            // Clicking same category again: reset to "全部"
            setActiveFilter("全部");
            setActiveSubFilter(null);
        } else {
            setActiveFilter(label);
            setActiveSubFilter(null);
        }
    }, [activeFilter]);

    // Compute sub-options for the active category
    const subFilterOptions = useMemo(() => {
        // Only show sub-filters for actual categories (not 全部/文件夹)
        const cat = CATEGORIES[activeFilter];
        if (!cat) return null;

        const counts: Record<string, number> = {};
        for (const f of files) {
            if (f.is_dir || !f.extension) continue;
            const ext = f.extension.toUpperCase();
            if (cat.exts.has(ext)) {
                counts[ext] = (counts[ext] || 0) + 1;
            }
        }
        const exts = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        // Only show sub-filters if there are 2+ different formats
        if (exts.length < 2) return null;
        return exts.map(([ext, count]) => ({ label: ext, count }));
    }, [files, activeFilter, CATEGORIES]);

    // Also compute sub-options for "其他" category
    const otherSubFilterOptions = useMemo(() => {
        if (activeFilter !== "其他") return null;
        const counts: Record<string, number> = {};
        for (const f of files) {
            if (f.is_dir || !f.extension) continue;
            const ext = f.extension.toUpperCase();
            if (!Object.values(CATEGORIES).some(({ exts }) => exts.has(ext))) {
                counts[ext] = (counts[ext] || 0) + 1;
            }
        }
        const exts = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (exts.length < 2) return null;
        return exts.map(([ext, count]) => ({ label: ext, count }));
    }, [files, activeFilter, CATEGORIES]);

    const activeSubOptions = subFilterOptions || otherSubFilterOptions;

    // Filtered file list based on category + sub-filter
    const filteredFiles = useMemo(() => {
        if (activeFilter === "全部") return files;
        if (activeFilter === "文件夹") return files.filter(f => f.is_dir);

        // If a specific sub-format is selected, filter to just that extension
        if (activeSubFilter) {
            return files.filter(f => !f.is_dir && f.extension?.toUpperCase() === activeSubFilter);
        }

        if (activeFilter === "其他") {
            return files.filter(f => {
                if (f.is_dir) return false;
                if (!f.extension) return true;
                const ext = f.extension.toUpperCase();
                return !Object.values(CATEGORIES).some(({ exts }) => exts.has(ext));
            });
        }
        const cat = CATEGORIES[activeFilter];
        if (!cat) return files;
        return files.filter(f => !f.is_dir && cat.exts.has(f.extension?.toUpperCase() || ""));
    }, [files, activeFilter, activeSubFilter, CATEGORIES]);

    const loadFiles = async () => {
        setLoading(true);
        try {
            const result: FileInfo[] = await invoke("list_files", { dir: null });
            setFiles(result);
        } catch (err) {
            console.error("Failed to load files:", err);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadFiles();
    }, []);

    // ===== 插件加工（格式转换 / OCR）=====
    const refreshConversions = useCallback(async () => {
        try {
            const [tasks, records] = await Promise.all([
                invoke<ConvertTask[]>("get_plugin_tasks"),
                invoke<PluginOutput[]>("get_plugin_outputs"),
            ]);
            setConversions(tasks);
            setOutputs(records);
        } catch (err) {
            console.error("Failed to fetch plugin tasks:", err);
        }
    }, []);

    // 挂载时恢复进行中的任务状态，并从插件清单取各能力支持的输入格式
    // （格式列表与插件是否已安装无关——否则未安装时右键菜单不显示入口，用户无从发现功能）
    useEffect(() => {
        refreshConversions();
        invoke<EngineInfo>("detect_convert_engine")
            .then(info => setConvertibleInputs(new Set(info.inputs.map(i => i.toUpperCase()))))
            .catch(err => console.error("Failed to detect convert engine:", err));
        invoke<PluginInfo[]>("list_plugins")
            .then(list => {
                const ocr = list.find(p => p.capability === "ocr");
                setOcrInputs(new Set((ocr?.inputs ?? []).map(i => i.toUpperCase())));
                setOcrPluginId(ocr?.id ?? "");
            })
            .catch(err => console.error("Failed to list plugins:", err));
        invoke<PluginAction[]>("list_plugin_actions")
            .then(setActions)
            .catch(err => console.error("Failed to list plugin actions:", err));
    }, [refreshConversions]);

    // 任务结束（成功/失败）后刷新文件列表与任务状态
    useEffect(() => {
        const unlisten = listen("plugin-task", () => {
            loadFiles();
            refreshConversions();
        });
        return () => {
            unlisten.then(f => f());
        };
    }, [refreshConversions]);

    // 有任务运行中时每秒轮询进度
    const hasRunningConversion = conversions.some(c => c.status === "Running");
    useEffect(() => {
        if (!hasRunningConversion) return;
        const interval = setInterval(refreshConversions, 1000);
        return () => clearInterval(interval);
    }, [hasRunningConversion, refreshConversions]);

    // 输入文件路径 → 运行中的转换任务
    const convertingByPath = useMemo(() => {
        const map = new Map<string, ConvertTask>();
        for (const c of conversions) {
            if (c.status === "Running") map.set(c.input_path, c);
        }
        return map;
    }, [conversions]);

    /** 加工记录的两个视角：这个文件被加工过（源） / 这个文件是加工产物 */
    const marks = useMemo(() => {
        const asSource = new Map<string, PluginOutput[]>();
        const asOutput = new Map<string, PluginOutput>();
        for (const o of outputs) {
            asOutput.set(o.output_path, o);
            const list = asSource.get(o.source_path) ?? [];
            list.push(o);
            asSource.set(o.source_path, list);
        }
        return { asSource, asOutput };
    }, [outputs]);

    /**
     * 动作产物在任务记录里把动作 id 存进了 target_format（转换任务存的是目标格式，
     * 清单校验保证两者不重名）。这里回查动作名——查得到就说明它是动作产物。
     */
    const actionOf = useCallback(
        (o: PluginOutput) =>
            actions.find(a => a.plugin_id === o.plugin_id && a.action_id === o.target_format),
        [actions],
    );

    /** 渲染「已 OCR / 已转 MOBI / 已瘦身优化 / 插件生成」这类标记 */
    const renderMarks = (file: FileInfo) => {
        const produced = marks.asSource.get(file.path) ?? [];
        const from = marks.asOutput.get(file.path);
        if (!produced.length && !from) return null;

        const chips: { label: string; title: string; tone: "done" | "derived" }[] = [];

        // 这个文件被加工过 —— 提醒用户「这本你处理过了」
        const ocred = produced.filter(o => o.capability === "ocr");
        if (ocred.length) {
            chips.push({
                label: "已 OCR",
                title: `已识别，生成了 ${ocred.map(o => o.output_name).join("、")}`,
                tone: "done",
            });
        }
        // 格式转换：capability 为 convert 且不是该插件的某个动作
        const converted = produced.filter(o => o.capability === "convert" && !actionOf(o));
        if (converted.length) {
            const fmts = [...new Set(converted.map(o => (o.target_format ?? "").toUpperCase()))]
                .filter(Boolean);
            chips.push({
                label: fmts.length ? `已转 ${fmts.join("/")}` : "已转换",
                title: `已转换，生成了 ${converted.map(o => o.output_name).join("、")}`,
                tone: "done",
            });
        }
        // 动作（瘦身、解锁…）：每种动作一个标记
        for (const o of produced) {
            const action = actionOf(o);
            if (!action || chips.some(c => c.label === `已${action.name}`)) continue;
            chips.push({
                label: `已${action.name}`,
                title: `${action.plugin_name} · ${action.name}，生成了 ${o.output_name}`,
                tone: "done",
            });
        }

        // 这个文件本身是加工产物 —— 说清它从哪来的
        if (from) {
            const action = actionOf(from);
            chips.push({
                label: action
                    ? `${action.name}生成`
                    : from.capability === "ocr" ? "OCR 生成" : "转换生成",
                title: `源文件：${from.source_name}`,
                tone: "derived",
            });
        }

        return chips.map(chip => (
            <span
                key={chip.label}
                className="badge"
                title={chip.title}
                style={{
                    display: "flex", alignItems: "center", gap: 3, flexShrink: 0,
                    background: chip.tone === "done"
                        ? "rgba(34, 197, 94, 0.14)"
                        : "rgba(var(--accent-rgb), 0.14)",
                    color: chip.tone === "done" ? "#22c55e" : "var(--accent)",
                }}
            >
                {chip.tone === "done"
                    ? <CheckCircle2 size={10} />
                    : <Sparkles size={10} />}
                {chip.label}
            </span>
        ));
    };

    const handleOpen = async (file: FileInfo) => {
        try {
            await invoke("open_file", { path: file.path });
        } catch (err) {
            console.error("Failed to open file:", err);
        }
    };

    const handleDelete = async (file: FileInfo) => {
        const confirmed = await confirm(`确定要删除 "${file.name}" 吗？`, {
            title: "删除确认",
            kind: "warning",
            okLabel: "删除",
            cancelLabel: "取消",
        });
        if (!confirmed) return;
        try {
            await invoke("delete_file", { path: file.path });
            await loadFiles();
        } catch (err) {
            console.error("Failed to delete:", err);
        }
    };

    const handleOpenInExplorer = async (file: FileInfo) => {
        try {
            await invoke("open_in_explorer", { path: file.path });
        } catch (err) {
            console.error("Failed to open in explorer:", err);
        }
    };

    const handleContextMenu = useCallback((e: React.MouseEvent, file: FileInfo) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, file });
    }, []);

    const closeContextMenu = useCallback(() => {
        setContextMenu(null);
    }, []);

    const handleOcr = async (file: FileInfo) => {
        try {
            const available: boolean = await invoke("ocr_available");
            if (!available) {
                toast("需要先安装「OCR 文字识别」插件", { icon: "🧩", duration: 4000 });
                navigate("/plugins");
                return;
            }
            await invoke("ocr_document", { inputPath: file.path });
            toast("已开始识别，完成后会生成可搜索的 PDF", { icon: "🔍", duration: 4000 });
            refreshConversions();
        } catch (err) {
            console.error("Failed to start OCR:", err);
            toast.error(String(err), { duration: 5000 });
        }
    };

    const handleAction = async (file: FileInfo, action: PluginAction) => {
        if (!action.installed) {
            toast(`需要先安装「${action.plugin_name}」插件`, { icon: "🧩", duration: 4000 });
            navigate("/plugins");
            return;
        }
        try {
            await invoke("run_plugin_action", {
                pluginId: action.plugin_id,
                actionId: action.action_id,
                inputPath: file.path,
            });
            toast(`已开始${action.name}`, { icon: "🪄", duration: 3000 });
            refreshConversions();
        } catch (err) {
            console.error("Failed to run plugin action:", err);
            toast.error(String(err), { duration: 5000 });
        }
    };

    const getContextMenuItems = (file: FileInfo): ContextMenuItem[] => {
        const items: ContextMenuItem[] = [
            {
                label: '打开文件',
                icon: <ExternalLink size={15} />,
                onClick: () => handleOpen(file),
            },
            {
                label: '在文件夹中打开',
                icon: <FolderOpen size={15} />,
                onClick: () => handleOpenInExplorer(file),
            },
        ];
        const busy = convertingByPath.has(file.path);
        if (!file.is_dir && convertibleInputs.has(file.extension.toUpperCase())) {
            items.push({
                label: busy ? '处理中…' : '转换格式',
                icon: <Repeat size={15} />,
                onClick: () => setConvertFile(file),
                disabled: busy,
            });
        }
        if (!file.is_dir && ocrInputs.has(file.extension.toUpperCase())) {
            const alreadyOcred = (marks.asSource.get(file.path) ?? [])
                .some(o => o.capability === "ocr");
            items.push({
                label: busy
                    ? '处理中…'
                    : alreadyOcred ? '重新 OCR 识别' : 'OCR 识别（可搜索 PDF）',
                icon: <ScanText size={15} />,
                onClick: () => handleOcr(file),
                disabled: busy,
            });
        }
        // 插件清单声明的一键动作 —— 新增插件不需要改这里
        if (!file.is_dir) {
            const ext = file.extension.toLowerCase();
            for (const action of actions.filter(a => a.inputs.includes(ext))) {
                items.push({
                    label: busy ? '处理中…' : action.name,
                    icon: <Wand2 size={15} />,
                    onClick: () => handleAction(file, action),
                    disabled: busy,
                });
            }
        }
        items.push(
            { label: '', onClick: () => { }, divider: true },
            {
                label: '删除',
                icon: <Trash2 size={15} />,
                onClick: () => handleDelete(file),
                danger: true,
            },
        );
        return items;
    };

    return (
        <div className="page-container">
            <div className="page-header flex items-center justify-between">
                <div>
                    <h1 className="page-title">书架</h1>
                    <p className="page-subtitle">管理已下载的电子书</p>
                </div>
                <div className="flex gap-2">
                    <button
                        className={`btn btn-sm ${lanRunning ? "btn-wireless-active" : "btn-secondary"}`}
                        onClick={() => setShowWireless(true)}
                    >
                        {lanRunning ? (
                            <>
                                <span className="wireless-dot" />
                                <Wifi size={14} />
                                传书中
                            </>
                        ) : (
                            <>
                                <WifiOff size={14} />
                                无线传书
                            </>
                        )}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={loadFiles}>
                        <RefreshCw size={14} />
                        刷新
                    </button>
                </div>
            </div>

            {/* Inline filter chips */}
            {files.length > 0 && filterOptions.length > 1 && (
                <div className="filter-chips-wrapper">
                    <div className="filter-chips">
                        {filterOptions.map(opt => (
                            <button
                                key={opt.label}
                                className={`filter-chip ${activeFilter === opt.label ? "filter-chip-active" : ""}`}
                                onClick={() => handleCategoryClick(opt.label)}
                            >
                                {opt.label === "文件夹" && <Folder size={13} />}
                                {opt.label === "电子书" && <BookOpen size={13} />}
                                {opt.label === "文档" && <FileText size={13} />}
                                {opt.label === "图片" && <Image size={13} />}
                                {opt.label === "音视频" && <Film size={13} />}
                                {opt.label === "其他" && <Package size={13} />}
                                <span>{opt.label}</span>
                                <span className="filter-chip-count">{opt.count}</span>
                            </button>
                        ))}
                    </div>
                    {/* Secondary sub-filter row */}
                    {activeSubOptions && (
                        <div className="filter-sub-chips">
                            <button
                                className={`filter-sub-chip ${activeSubFilter === null ? "filter-sub-chip-active" : ""}`}
                                onClick={() => setActiveSubFilter(null)}
                            >
                                全部
                            </button>
                            {activeSubOptions.map(sub => (
                                <button
                                    key={sub.label}
                                    className={`filter-sub-chip ${activeSubFilter === sub.label ? "filter-sub-chip-active" : ""}`}
                                    onClick={() => setActiveSubFilter(sub.label)}
                                >
                                    {sub.label}
                                    <span className="filter-sub-chip-count">{sub.count}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div style={{
                height: "calc(100vh - 180px)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column"
            }}>
                <div className="card" style={{
                    padding: 8,
                    flex: 1,
                    overflow: "auto",
                    minHeight: 0
                }}>
                    {loading ? (
                        <div className="empty-state" style={{ padding: 40 }}>
                            <RefreshCw size={24} className="spinner" />
                        </div>
                    ) : files.length === 0 ? (
                        <div className="empty-state" style={{ padding: 40 }}>
                            <FolderOpen size={36} className="empty-state-icon" />
                            <p className="empty-state-text">下载文件夹为空</p>
                            <p className="empty-state-hint">搜索并下载书籍后将显示在此处</p>
                        </div>
                    ) : (
                        filteredFiles.map((file) => (
                            <div
                                key={file.path}
                                className="file-item"
                                onDoubleClick={() => handleOpen(file)}
                                onContextMenu={(e) => handleContextMenu(e, file)}
                            >
                                <div className={`file-icon ${file.is_dir ? "" : getFileIconClass(file.extension)}`}>
                                    {file.is_dir ? (
                                        <Folder size={20} />
                                    ) : (
                                        <FileText size={20} />
                                    )}
                                </div>
                                <div className="file-info">
                                    <div className="file-name">{file.name}</div>
                                    <div className="file-meta">
                                        {file.is_dir ? "文件夹" : formatSize(file.size)}
                                        {file.modified && ` · ${file.modified}`}
                                    </div>
                                </div>
                                {!file.is_dir && (
                                    <div style={{
                                        display: "flex", alignItems: "center", gap: 6,
                                        flexShrink: 0, marginLeft: 8,
                                    }}>
                                        {convertingByPath.has(file.path) && (() => {
                                            const task = convertingByPath.get(file.path)!;
                                            const isOcr = !!ocrPluginId && task.plugin_id === ocrPluginId;
                                            // 动作任务的 target_format 存的是动作 id，显示时换回动作名
                                            const action = actions.find(
                                                a => a.plugin_id === task.plugin_id && a.action_id === task.target_format,
                                            );
                                            const label = isOcr
                                                ? "OCR 识别中"
                                                : action
                                                    ? `${action.name}中`
                                                    : `转换为 ${task.target_format.toUpperCase()}`;
                                            return (
                                                <span className="badge" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                    <RefreshCw size={11} className="spinner" />
                                                    {label}
                                                    {task.progress > 0 && ` ${Math.round(task.progress)}%`}
                                                </span>
                                            );
                                        })()}
                                        {renderMarks(file)}
                                        <span className="badge badge-accent">
                                            {file.extension.toUpperCase()}
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
            {/* Context Menu */}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={getContextMenuItems(contextMenu.file)}
                    onClose={closeContextMenu}
                />
            )}
            {/* Wireless Transfer Dialog */}
            {showWireless && (
                <WirelessTransfer onClose={() => setShowWireless(false)} />
            )}
            {/* Format Convert Dialog */}
            {convertFile && (
                <ConvertDialog
                    fileName={convertFile.name}
                    filePath={convertFile.path}
                    extension={convertFile.extension}
                    onClose={() => setConvertFile(null)}
                    onStarted={refreshConversions}
                />
            )}
        </div>
    );
}
