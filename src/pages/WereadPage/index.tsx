import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen, Loader2, Clock, Calendar, TrendingUp, Settings, RefreshCw, Search, FileDown } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import toast from "react-hot-toast";
import WereadBookDetailModal from "../../components/WereadBookDetailModal";
import { searchInLibrary } from "../../utils/searchInLibrary";
import { buildNotesMarkdown, sanitizeFilename } from "../../utils/wereadExport";

interface NotebookBook {
  bookId: string;
  book: { bookId: string; title: string; author?: string; cover?: string };
  reviewCount: number;
  noteCount: number;
  bookmarkCount: number;
  readingProgress?: number;
  sort: number;
}

interface StatsData {
  totalReadTime: number;
  readDays?: number;
  dayAverageReadTime?: number;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0";
  const hours = seconds / 3600;
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}min`;
}


export default function WereadPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [notebooks, setNotebooks] = useState<NotebookBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const cfg: any = await invoke("get_config");
      const hasKey = cfg.weread_api_key && cfg.weread_api_key.length > 0;
      setConfigured(hasKey);

      if (!hasKey) {
        setLoading(false);
        return;
      }

      const [statsData, notebooksData] = await Promise.all([
        invoke("weread_get_stats").catch(() => null),
        invoke("weread_get_notebooks").catch(() => null),
      ]);

      if (statsData) {
        setStats(statsData as StatsData);
      }
      if (notebooksData) {
        const data = notebooksData as any;
        setNotebooks(data.books || []);
      }
      setError("");
    } catch (err: any) {
      setError(err?.toString() || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleExportAll = async () => {
    if (notebooks.length === 0 || exportProgress) return;
    const dir = await open({ directory: true, title: "选择笔记导出目录" });
    if (!dir) return;

    const failed: string[] = [];
    for (let i = 0; i < notebooks.length; i++) {
      const nb = notebooks[i];
      setExportProgress({ current: i + 1, total: notebooks.length });
      try {
        const [chaptersData, bookmarksData, reviewsData] = await Promise.all([
          invoke("weread_get_chapters", { bookId: nb.bookId }).catch(() => null),
          invoke("weread_get_bookmarks", { bookId: nb.bookId }).catch(() => null),
          invoke("weread_get_my_reviews", { bookId: nb.bookId }).catch(() => null),
        ]);
        const chapters = (chaptersData as any)?.chapters || [];
        const bookmarks = (bookmarksData as any)?.updated || [];
        const reviews = ((reviewsData as any)?.reviews || []).map((r: any) => r.review || r);
        const md = buildNotesMarkdown(
          { title: nb.book.title, author: nb.book.author },
          chapters, bookmarks, reviews,
        );
        await invoke("weread_save_notes", {
          path: `${dir}/${sanitizeFilename(nb.book.title)}.md`,
          content: md,
        });
      } catch (err) {
        console.error(`导出《${nb.book.title}》失败:`, err);
        failed.push(nb.book.title);
      }
    }
    setExportProgress(null);

    if (failed.length === 0) {
      toast.success(`已导出 ${notebooks.length} 本书的笔记`, { icon: "📝" });
    } else {
      toast.error(`导出完成：成功 ${notebooks.length - failed.length} 本，失败 ${failed.length} 本（${failed.slice(0, 3).join("、")}${failed.length > 3 ? " 等" : ""}）`, { duration: 8000 });
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <Loader2 className="spin" size={32} style={{ color: "var(--text-secondary)" }} />
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="page-container" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "16px" }}>
        <BookOpen size={48} style={{ color: "var(--text-secondary)", opacity: 0.5 }} />
        <h2 style={{ color: "var(--text-primary)", margin: 0 }}>微信读书</h2>
        <p style={{ color: "var(--text-secondary)", margin: 0, textAlign: "center", maxWidth: "400px" }}>
          未配置微信读书 API Key，请在设置页面中配置后使用
        </p>
        <button
          className="btn btn-primary"
          onClick={() => window.dispatchEvent(new CustomEvent("olib:navigate", { detail: "/settings" }))}
          style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "8px", padding: "10px 24px", borderRadius: "12px", background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}
        >
          <Settings size={16} />
          前往设置
        </button>
      </div>
    );
  }

  const displayBooks = showAll ? notebooks : notebooks.slice(0, 12);

  return (
    <div className="page-container" style={{ padding: "24px 32px", overflowY: "auto", height: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700, color: "var(--text-primary)" }}>微信读书</h1>
        <div style={{ display: "flex", gap: "8px" }}>
          {notebooks.length > 0 && (
            <button
              onClick={handleExportAll}
              disabled={!!exportProgress}
              title="将所有书的划线和想法导出为 Markdown 文件"
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", borderRadius: "10px", border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-secondary)", cursor: exportProgress ? "default" : "pointer", fontSize: "13px" }}
            >
              {exportProgress ? (
                <>
                  <Loader2 size={14} className="spin" />
                  导出中 {exportProgress.current}/{exportProgress.total}
                </>
              ) : (
                <>
                  <FileDown size={14} />
                  导出全部笔记
                </>
              )}
            </button>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", borderRadius: "10px", border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "13px" }}
          >
            <RefreshCw size={14} className={refreshing ? "spin" : ""} />
            刷新
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "12px", background: "rgba(239,68,68,0.1)", color: "#ef4444", marginBottom: "20px", fontSize: "13px" }}>
          {error}
        </div>
      )}

      {/* Stats Card */}
      {stats && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <Clock size={18} style={{ color: "var(--accent)" }} />
            <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>阅读统计</span>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "0",
            padding: "24px",
            borderRadius: "16px",
            background: "linear-gradient(135deg, rgba(var(--accent-rgb, 0,159,170), 0.08), rgba(var(--accent-rgb, 0,159,170), 0.03))",
            border: "1px solid var(--border)",
            marginBottom: "28px",
          }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "rgba(var(--accent-rgb, 0,159,170), 0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Clock size={18} style={{ color: "var(--accent)" }} />
              </div>
              <span style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-primary)" }}>{formatDuration(stats.totalReadTime)}</span>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>总阅读时长</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "rgba(139,92,246,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Calendar size={18} style={{ color: "#8b5cf6" }} />
              </div>
              <span style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-primary)" }}>{stats.readDays ?? 0}</span>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>阅读天数</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "rgba(59,130,246,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <TrendingUp size={18} style={{ color: "#3b82f6" }} />
              </div>
              <span style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-primary)" }}>{formatDuration(stats.dayAverageReadTime ?? 0)}</span>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>日均阅读</span>
            </div>
          </div>
        </>
      )}

      {/* Notebooks / Notes Section */}
      {notebooks.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <BookOpen size={18} style={{ color: "var(--accent)" }} />
            <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>笔记</span>
            <span style={{ fontSize: "12px", padding: "2px 10px", borderRadius: "10px", background: "rgba(var(--accent-rgb, 0,159,170), 0.1)", color: "var(--accent)", fontWeight: 600 }}>
              {notebooks.length} 本
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {displayBooks.map((nb) => (
              <div
                key={nb.bookId}
                onClick={() => setSelectedBookId(nb.bookId)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  padding: "14px",
                  borderRadius: "14px",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {/* Cover */}
                <div style={{ width: "42px", height: "56px", borderRadius: "6px", overflow: "hidden", flexShrink: 0, background: "var(--bg-tertiary)" }}>
                  {nb.book.cover ? (
                    <img
                      src={nb.book.cover}
                      alt={nb.book.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <BookOpen size={16} style={{ color: "var(--text-secondary)" }} />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {nb.book.title}
                  </div>
                  <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                    <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "8px", background: "var(--bg-tertiary)", color: "var(--text-secondary)", fontWeight: 500 }}>
                      划线 {nb.noteCount}
                    </span>
                    <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "8px", background: "var(--bg-tertiary)", color: "var(--text-secondary)", fontWeight: 500 }}>
                      想法 {nb.reviewCount}
                    </span>
                  </div>
                </div>

                {/* Search in Z-Library */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    searchInLibrary(nb.book.title);
                  }}
                  title="去 Z 站搜索下载电子书"
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "6px 12px", borderRadius: "10px", flexShrink: 0,
                    border: "1px solid var(--border)", background: "transparent",
                    color: "var(--text-secondary)", cursor: "pointer", fontSize: "12px",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }}
                >
                  <Search size={13} />
                  找电子书
                </button>

                {/* Progress Ring */}
                {(nb.readingProgress ?? 0) > 0 && (
                  <div style={{ width: "40px", height: "40px", position: "relative", flexShrink: 0 }}>
                    <svg width="40" height="40" viewBox="0 0 40 40">
                      <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border)" strokeWidth="3" />
                      <circle
                        cx="20" cy="20" r="16" fill="none"
                        stroke="var(--accent)" strokeWidth="3"
                        strokeDasharray={`${(nb.readingProgress! / 100) * 100.53} 100.53`}
                        strokeLinecap="round"
                        transform="rotate(-90 20 20)"
                      />
                    </svg>
                    <span style={{
                      position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "9px", fontWeight: 700, color: "var(--text-secondary)"
                    }}>
                      {nb.readingProgress}%
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {notebooks.length > 12 && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: "12px" }}>
              <button
                onClick={() => setShowAll(!showAll)}
                style={{ padding: "8px 20px", borderRadius: "10px", border: "1px solid var(--border)", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
              >
                {showAll ? "收起" : `查看全部 (${notebooks.length})`}
              </button>
            </div>
          )}
        </>
      )}

      {!loading && !error && notebooks.length === 0 && stats && (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          <BookOpen size={36} style={{ opacity: 0.3, marginBottom: "12px" }} />
          <p>暂无笔记数据</p>
        </div>
      )}

      {/* Book Detail Modal */}
      {selectedBookId && (
        <WereadBookDetailModal
          bookId={selectedBookId}
          onClose={() => setSelectedBookId(null)}
        />
      )}
    </div>
  );
}
