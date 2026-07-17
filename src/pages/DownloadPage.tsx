import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
    Download, CheckCircle2, XCircle, Loader2, Pause, Trash2,
    History, Calendar, FileText, RefreshCw, CloudDownload, ExternalLink,
    ArrowRight, AlertTriangle,
} from "lucide-react";
import toast from "react-hot-toast";

// === Types ===

interface DownloadTask {
    book_id: string;
    title: string;
    progress: number;
    speed_kbps: number;
    status: string;
    error?: string;
    downloaded_bytes?: number;
    total_bytes?: number;
}

interface DownloadedBook {
    id: string;
    title: string;
    author?: string;
    year?: number;
    extension?: string;
    filesize?: number;
    downloaded_at?: string;
    cover?: string;
}

type TabKey = "tasks" | "history";

// === Helpers ===

function formatSize(bytes: number): string {
    if (!bytes) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(1)} ${units[i]}`;
}

function formatETA(downloaded: number, total: number, speedKbps: number): string {
    if (!total || !speedKbps || speedKbps < 0.1 || downloaded >= total) return "";
    const remainingBytes = total - downloaded;
    const speedBps = speedKbps * 1024; // convert KB/s to B/s
    const remainingSec = remainingBytes / speedBps;
    if (remainingSec < 60) return `剩余 ${Math.ceil(remainingSec)} 秒`;
    if (remainingSec < 3600) return `剩余 ${Math.ceil(remainingSec / 60)} 分钟`;
    const hours = Math.floor(remainingSec / 3600);
    const mins = Math.ceil((remainingSec % 3600) / 60);
    return `剩余 ${hours} 小时 ${mins} 分钟`;
}

function formatDate(dateStr?: string): string {
    if (!dateStr) return "—";
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString("zh-CN", {
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit",
        });
    } catch { return dateStr; }
}

// === Main Component ===

export default function DownloadPage() {
    const [activeTab, setActiveTab] = useState<TabKey>("tasks");

    // Download tasks state
    const [downloads, setDownloads] = useState<DownloadTask[]>([]);

    // Cloud history state
    const [historyBooks, setHistoryBooks] = useState<DownloadedBook[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState("");
    const [historyPage, setHistoryPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);

    // Poll download tasks
    useEffect(() => {
        const fetchDownloads = async () => {
            try {
                const tasks: DownloadTask[] = await invoke("get_all_downloads");
                setDownloads(tasks);
            } catch (err) {
                console.error("Failed to fetch downloads:", err);
            }
        };

        fetchDownloads();
        const interval = setInterval(fetchDownloads, 1000);
        return () => clearInterval(interval);
    }, []);

    // Load cloud history
    useEffect(() => {
        if (activeTab === "history") {
            loadHistory(1, true);
        }
    }, [activeTab]);

    const loadHistory = async (page: number, reset = false) => {
        setHistoryLoading(true);
        setHistoryError("");
        try {
            const result: any = await invoke("get_download_history", {
                order: "date_down", page, limit: 20,
            });
            if (result.books) {
                setHistoryBooks(prev => reset ? result.books : [...prev, ...result.books]);
                setHasMore(result.books.length === 20);
                setHistoryPage(page);
            } else {
                setHistoryError("暂无云端下载记录");
                setHasMore(false);
            }
        } catch (err: any) {
            console.error("Failed to load history:", err);
            setHistoryError(err.toString() || "加载下载记录失败，请先登录");
            setHasMore(false);
        } finally {
            setHistoryLoading(false);
        }
    };

    // Download task actions
    const handleCancel = async (bookId: string) => {
        try {
            await invoke("cancel_download", { bookId });
            // Don't immediately delete — let the download loop detect cancellation
            // and update status to "Cancelled". The user can then delete it manually.
            toast.success("已取消下载");
        } catch (err) {
            console.error("Cancel failed:", err);
            toast.error("取消失败");
        }
    };

    const handleDelete = async (bookId: string) => {
        try {
            await invoke("delete_download", { bookId });
            setDownloads(downloads.filter(d => d.book_id !== bookId));
            toast.success("已删除");
        } catch (err) {
            console.error("Delete failed:", err);
            toast.error("删除失败");
        }
    };

    const statusIcon = (status: string) => {
        switch (status) {
            case "Completed":
                return <CheckCircle2 size={18} style={{ color: "var(--success)" }} />;
            case "Failed":
                return <XCircle size={18} style={{ color: "var(--error)" }} />;
            case "Cancelled":
                return <Pause size={18} style={{ color: "var(--warning)" }} />;
            case "Downloading":
                return <Loader2 size={18} className="spinner" style={{ color: "var(--accent)" }} />;
            case "Dispatched":
                return <ExternalLink size={18} style={{ color: "var(--accent-light)" }} />;
            default:
                return <Download size={18} style={{ color: "var(--text-muted)" }} />;
        }
    };

    const statusLabel = (status: string) => {
        const map: Record<string, string> = {
            Pending: "等待中", Downloading: "下载中",
            Completed: "已完成", Failed: "失败", Cancelled: "已取消",
            Dispatched: "已转交",
        };
        return map[status] || status;
    };

    const statusBadgeClass = (status: string) => {
        switch (status) {
            case "Completed": return "badge-success";
            case "Failed": return "badge-error";
            case "Cancelled": return "badge-warning";
            case "Dispatched": return "badge-accent";
            default: return "badge-accent";
        }
    };

    const activeCount = downloads.filter(d => d.status === "Downloading" || d.status === "Pending").length;
    const failedCount = downloads.filter(d => d.status === "Failed").length;

    // Dismiss state for the failed-download tip
    const [tipDismissed, setTipDismissed] = useState(false);
    const showFailedTip = failedCount > 0 && !tipDismissed;

    const handleGoToSettings = () => {
        window.dispatchEvent(new CustomEvent("olib:navigate", { detail: "/settings" }));
    };

    const tabs = [
        {
            key: "tasks" as TabKey,
            icon: Download,
            label: "下载任务",
            badge: activeCount > 0 ? activeCount : undefined,
        },
        {
            key: "history" as TabKey,
            icon: CloudDownload,
            label: "云端记录",
        },
    ];

    return (
        <div className="page-container">
            {/* Header */}
            <div className="page-header">
                <h1 className="page-title">下载</h1>
                <p className="page-subtitle">管理下载任务和查看云端下载记录</p>
            </div>

            {/* Tab Bar */}
            <div style={{
                display: "flex",
                gap: "6px",
                marginBottom: "20px",
                background: "var(--bg-tertiary)",
                borderRadius: "var(--radius-lg)",
                padding: "4px",
            }}>
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.key;
                    return (
                        <button
                            key={tab.key}
                            className="btn"
                            onClick={() => setActiveTab(tab.key)}
                            style={{
                                flex: 1,
                                padding: "10px 16px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "8px",
                                borderRadius: "var(--radius-md)",
                                background: isActive ? "var(--bg-surface)" : "transparent",
                                color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                                border: "none",
                                boxShadow: isActive ? "var(--shadow-sm)" : "none",
                                cursor: "pointer",
                                transition: "all var(--transition-fast)",
                                fontSize: "13px",
                                fontWeight: isActive ? 600 : 400,
                            }}
                        >
                            <tab.icon size={16} />
                            {tab.label}
                            {tab.badge && (
                                <span style={{
                                    background: "var(--accent)",
                                    color: "white",
                                    fontSize: "10px",
                                    fontWeight: 700,
                                    padding: "1px 6px",
                                    borderRadius: "100px",
                                    minWidth: "18px",
                                    textAlign: "center",
                                }}>
                                    {tab.badge}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* === Tab: Download Tasks === */}
            {activeTab === "tasks" && (
                <>
                    {/* Tip: switch download method when downloads fail */}
                    {showFailedTip && (
                        <div
                            style={{
                                padding: "12px 16px",
                                marginBottom: "16px",
                                background: "rgba(251, 191, 36, 0.08)",
                                border: "1px solid rgba(251, 191, 36, 0.25)",
                                borderRadius: "var(--radius-lg)",
                                display: "flex",
                                alignItems: "flex-start",
                                gap: "10px",
                                animation: "fadeIn 300ms ease",
                            }}
                        >
                            <AlertTriangle
                                size={18}
                                style={{ color: "#f59e0b", flexShrink: 0, marginTop: "1px" }}
                            />
                            <div style={{ flex: 1 }}>
                                <div style={{
                                    fontSize: "13px",
                                    fontWeight: 600,
                                    color: "var(--text-primary)",
                                    marginBottom: "2px",
                                }}>
                                    有 {failedCount} 个下载失败
                                </div>
                                <div style={{
                                    fontSize: "12px",
                                    color: "var(--text-muted)",
                                    lineHeight: 1.6,
                                }}>
                                    下载速度过慢可能导致失败。试试前往 <strong style={{ color: "var(--text-secondary)" }}>设置 → 下载设置</strong> 切换下载方式（如浏览器、IDM 或 Motrix）。
                                </div>
                                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                                    <button
                                        onClick={handleGoToSettings}
                                        style={{
                                            padding: "4px 12px",
                                            fontSize: "11px",
                                            fontWeight: 600,
                                            color: "var(--accent)",
                                            background: "rgba(var(--accent-rgb, 99, 102, 241), 0.1)",
                                            border: "1px solid rgba(var(--accent-rgb, 99, 102, 241), 0.2)",
                                            borderRadius: "6px",
                                            cursor: "pointer",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: "4px",
                                            transition: "all 0.15s ease",
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = "rgba(var(--accent-rgb, 99, 102, 241), 0.18)";
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = "rgba(var(--accent-rgb, 99, 102, 241), 0.1)";
                                        }}
                                    >
                                        前往设置 <ArrowRight size={12} />
                                    </button>
                                    <button
                                        onClick={() => setTipDismissed(true)}
                                        style={{
                                            padding: "4px 10px",
                                            fontSize: "11px",
                                            fontWeight: 500,
                                            color: "var(--text-muted)",
                                            background: "transparent",
                                            border: "1px solid var(--border)",
                                            borderRadius: "6px",
                                            cursor: "pointer",
                                            transition: "all 0.15s ease",
                                        }}
                                    >
                                        我知道了
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {downloads.length === 0 ? (
                        <div className="empty-state">
                            <Download size={40} className="empty-state-icon" />
                            <p className="empty-state-text">暂无下载任务</p>
                            <p className="empty-state-hint">搜索书籍后点击下载按钮开始</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {downloads.map((dl) => (
                                <div key={dl.book_id} className="card" style={{ padding: "16px 20px" }}>
                                    <div className="flex items-center gap-3" style={{ marginBottom: dl.status === "Downloading" || dl.status === "Pending" ? 12 : 0 }}>
                                        {statusIcon(dl.status)}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div className="file-name">{dl.title}</div>
                                            <div className="file-meta" style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
                                                <span className={`badge ${statusBadgeClass(dl.status)}`}>
                                                    {statusLabel(dl.status)}
                                                </span>
                                                {dl.status === "Downloading" && (
                                                    <span className="text-muted" style={{ fontSize: "12px" }}>
                                                        {dl.speed_kbps.toFixed(1)} KB/s · {dl.progress.toFixed(1)}%
                                                        {dl.total_bytes ? ` · ${formatSize(dl.downloaded_bytes || 0)}/${formatSize(dl.total_bytes)}` : ""}
                                                        {dl.downloaded_bytes && dl.total_bytes && dl.speed_kbps > 0 ? (
                                                            <> · {formatETA(dl.downloaded_bytes, dl.total_bytes, dl.speed_kbps)}</>
                                                        ) : null}
                                                    </span>
                                                )}
                                                {dl.status === "Dispatched" && dl.error && (
                                                    <span style={{ color: "var(--accent-light)", fontSize: "12px", fontWeight: 500 }}>
                                                        {dl.error}
                                                    </span>
                                                )}
                                                {dl.status !== "Dispatched" && dl.error && (
                                                    <span style={{ color: "var(--error)", fontSize: "12px" }}>
                                                        {dl.error}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            {(dl.status === "Downloading" || dl.status === "Pending") ? (
                                                <button className="btn btn-ghost btn-sm" onClick={() => handleCancel(dl.book_id)}>
                                                    取消
                                                </button>
                                            ) : (
                                                <button
                                                    className="btn btn-ghost btn-icon btn-sm"
                                                    onClick={() => handleDelete(dl.book_id)}
                                                    title="删除"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {(dl.status === "Downloading" || dl.status === "Pending") && (
                                        <div className="progress-bar">
                                            <div className="progress-fill" style={{ width: `${dl.progress}%` }} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* === Tab: Cloud Download History === */}
            {activeTab === "history" && (
                <>
                    {/* Header with refresh */}
                    <div className="flex items-center justify-between" style={{ marginBottom: "16px" }}>
                        <div className="text-sm text-muted">
                            {historyBooks.length > 0 && `已加载 ${historyBooks.length} 条记录`}
                        </div>
                        <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => loadHistory(1, true)}
                            disabled={historyLoading}
                        >
                            <RefreshCw size={14} className={historyLoading && historyPage === 1 ? "spinner" : ""} />
                            刷新
                        </button>
                    </div>

                    {/* Loading (initial) */}
                    {historyLoading && historyBooks.length === 0 && (
                        <div className="empty-state">
                            <Loader2 size={40} className="spinner empty-state-icon" />
                            <p className="empty-state-text">正在加载云端记录...</p>
                        </div>
                    )}

                    {/* Error */}
                    {historyError && (
                        <div className="card" style={{
                            padding: "14px 18px",
                            marginBottom: "16px",
                            borderColor: "rgba(239, 68, 68, 0.3)",
                            background: "rgba(239, 68, 68, 0.06)",
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <div style={{
                                    width: "8px", height: "8px", borderRadius: "50%",
                                    background: "var(--error)", flexShrink: 0,
                                }} />
                                <span style={{ color: "var(--error)", fontSize: "13px" }}>{historyError}</span>
                                <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }}
                                    onClick={() => loadHistory(1, true)}>
                                    重试
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Empty */}
                    {!historyLoading && !historyError && historyBooks.length === 0 && (
                        <div className="empty-state">
                            <History size={40} className="empty-state-icon" />
                            <p className="empty-state-text">暂无云端下载记录</p>
                            <p className="empty-state-hint">你下载的书籍将在此显示</p>
                        </div>
                    )}

                    {/* History List */}
                    {historyBooks.length > 0 && (
                        <div className="flex flex-col gap-3">
                            {historyBooks.map((book, idx) => (
                                <div
                                    key={`${book.id}-${idx}`}
                                    className="card"
                                    style={{
                                        padding: 0,
                                        overflow: "hidden",
                                        transition: "all var(--transition-fast)",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = "var(--accent)";
                                        e.currentTarget.style.boxShadow = "var(--shadow-sm)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = "var(--border)";
                                        e.currentTarget.style.boxShadow = "none";
                                    }}
                                >
                                    <div style={{ display: "flex", gap: "0" }}>
                                        {/* Cover */}
                                        <div style={{
                                            width: "80px",
                                            minHeight: "100px",
                                            flexShrink: 0,
                                            background: "var(--bg-tertiary)",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            overflow: "hidden",
                                        }}>
                                            {book.cover ? (
                                                <img
                                                    src={book.cover}
                                                    alt={book.title}
                                                    loading="lazy"
                                                    style={{
                                                        width: "100%",
                                                        height: "100%",
                                                        objectFit: "cover",
                                                    }}
                                                    onError={(e) => {
                                                        const img = e.target as HTMLImageElement;
                                                        img.src = '';
                                                        img.style.visibility = 'hidden';
                                                    }}
                                                />
                                            ) : (
                                                <FileText size={28} style={{ opacity: 0.2 }} />
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div style={{
                                            flex: 1,
                                            minWidth: 0,
                                            padding: "14px 16px",
                                            display: "flex",
                                            flexDirection: "column",
                                            justifyContent: "center",
                                        }}>
                                            <div className="truncate" title={book.title} style={{
                                                fontSize: "14px",
                                                fontWeight: 600,
                                                color: "var(--text-primary)",
                                                marginBottom: "4px",
                                            }}>
                                                {book.title}
                                            </div>

                                            {book.author && (
                                                <div className="truncate text-muted" style={{
                                                    fontSize: "12px",
                                                    marginBottom: "8px",
                                                }}>
                                                    {book.author}
                                                </div>
                                            )}

                                            <div style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "10px",
                                                flexWrap: "wrap",
                                            }}>
                                                {book.downloaded_at && (
                                                    <div className="text-muted" style={{
                                                        fontSize: "11px",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: "4px",
                                                    }}>
                                                        <Calendar size={12} />
                                                        {formatDate(book.downloaded_at)}
                                                    </div>
                                                )}
                                                {book.extension && (
                                                    <span className="badge badge-accent" style={{
                                                        fontSize: "10px",
                                                        textTransform: "uppercase",
                                                    }}>
                                                        {book.extension}
                                                    </span>
                                                )}
                                                {book.filesize && (
                                                    <span className="text-muted" style={{ fontSize: "11px" }}>
                                                        {formatSize(book.filesize)}
                                                    </span>
                                                )}
                                                {book.year && (
                                                    <span className="text-muted" style={{ fontSize: "11px" }}>
                                                        {book.year}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Load More */}
                            {hasMore && (
                                <div style={{ textAlign: "center", padding: "16px 0" }}>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => loadHistory(historyPage + 1)}
                                        disabled={historyLoading}
                                    >
                                        {historyLoading ? (
                                            <><Loader2 size={14} className="spinner" /> 加载中...</>
                                        ) : (
                                            "加载更多"
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
