import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  downloadBook,
  listDownloadRecords,
  deleteDownloadRecord,
  type DownloadRecord,
} from "../api/download";
import { openFile, openInExplorer } from "../api/bookshelf";
import { useCoverCache } from "../hooks/useCoverCache";
import DownloadLimitDialog, { isDownloadLimitError } from "../components/DownloadLimitDialog";
import { describeDownloadError } from "../utils/downloadError";

const METHOD_LABELS: Record<string, string> = {
  browser: "浏览器下载",
  idm: "IDM 下载",
  motrix: "Motrix 下载",
  copy_url: "复制了链接",
};

const DISPATCH_TOASTS: Record<string, string> = {
  browser: "已发送到浏览器",
  idm: "已发送到 IDM",
  motrix: "已发送到 Motrix",
  copy_url: "链接已复制到剪贴板",
};

/** "YYYY-MM-DD HH:MM:SS" → 分组标题（今天 / 昨天 / 日期） */
function dayLabel(day: string): string {
  const today = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (day === fmt(today)) return "今天";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (day === fmt(yesterday)) return "昨天";
  return day;
}

/** 本机下载历史：每次下载（含转交外部工具）记一条，按时间从新到旧，可打开、定位、重新下载 */
export default function HistoryPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [limitError, setLimitError] = useState<string | null>(null);
  const { getCoverUrl } = useCoverCache();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRecords(await listDownloadRecords());
    } catch (err) {
      console.error("Failed to load download records:", err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时拉取数据
    load();
  }, [load]);

  /** 筛选后按天分组，保持后端给的新→旧顺序 */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? records.filter((r) =>
          [r.title, r.author, r.extension].some((v) => v?.toLowerCase().includes(q)),
        )
      : records;
    const map = new Map<string, DownloadRecord[]>();
    for (const r of matched) {
      const day = r.downloaded_at.slice(0, 10);
      const list = map.get(day) ?? [];
      list.push(r);
      map.set(day, list);
    }
    return [...map.entries()];
  }, [records, query]);

  const runFileAction = async (action: (path: string) => Promise<void>, r: DownloadRecord) => {
    if (!r.file_path) return;
    try {
      await action(r.file_path);
    } catch (err) {
      console.error("File action failed:", err);
      toast.error(String(err), { duration: 6000 });
    }
  };

  const handleRedownload = async (r: DownloadRecord) => {
    if (downloadingIds.has(r.book_id)) return;
    setDownloadingIds((prev) => new Set(prev).add(r.book_id));
    try {
      const result = await downloadBook({
        bookId: r.book_id,
        hashId: r.hash || "",
        title: r.title,
        extension: r.extension || "pdf",
        author: r.author,
        cover: r.cover,
      });
      if (result.startsWith("dispatched:")) {
        const method = result.split(":")[1];
        toast.success(DISPATCH_TOASTS[method] || "已转交外部工具", { icon: "🔗" });
      } else {
        toast.success(`下载成功: ${r.title}`);
      }
      load();
    } catch (err) {
      const errStr = String(err);
      if (isDownloadLimitError(errStr)) {
        setLimitError(errStr);
      } else {
        const text = describeDownloadError(err);
        if (text) toast.error(text, { duration: 6000 });
      }
    } finally {
      setDownloadingIds((prev) => {
        const n = new Set(prev);
        n.delete(r.book_id);
        return n;
      });
    }
  };

  const handleDeleteRecord = async (r: DownloadRecord) => {
    try {
      await deleteDownloadRecord(r.book_id);
      setRecords((prev) => prev.filter((x) => x.book_id !== r.book_id));
    } catch (err) {
      console.error("Failed to delete download record:", err);
      toast.error(`删除记录失败：${String(err)}`, { duration: 6000 });
    }
  };

  const renderRecord = (r: DownloadRecord) => {
    const coverUrl = getCoverUrl(r.book_id, r.cover ?? undefined);
    const downloading = downloadingIds.has(r.book_id);
    const missing = !!r.file_path && !r.file_exists;
    return (
      <div
        key={r.book_id}
        className="file-item history-item"
        onDoubleClick={() => r.file_exists && runFileAction(openFile, r)}
      >
        <div className="history-cover">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
          ) : (
            <FileText size={20} style={{ opacity: 0.3 }} />
          )}
        </div>
        <div className="file-info">
          <div className="file-name" title={r.title}>
            {r.title}
          </div>
          <div className="file-meta history-meta">
            <span className="history-time">{r.downloaded_at.slice(11, 16)}</span>
            {r.author && <span className="truncate">{r.author}</span>}
            {METHOD_LABELS[r.method] && <span>{METHOD_LABELS[r.method]}</span>}
            {missing && <span className="history-missing">文件已不在下载目录</span>}
          </div>
        </div>
        {r.extension && <span className="badge badge-accent">{r.extension.toUpperCase()}</span>}
        <div className="history-actions">
          {r.file_exists && (
            <>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title="打开文件"
                onClick={() => runFileAction(openFile, r)}
              >
                <ExternalLink size={16} />
              </button>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title="在文件夹中显示"
                onClick={() => runFileAction(openInExplorer, r)}
              >
                <FolderOpen size={16} />
              </button>
            </>
          )}
          {!r.file_exists && (
            <button
              className="btn btn-ghost btn-icon btn-sm"
              title="重新下载"
              disabled={downloading}
              onClick={() => handleRedownload(r)}
            >
              {downloading ? <Loader2 size={16} className="spinner" /> : <Download size={16} />}
            </button>
          )}
          <button
            className="btn btn-ghost btn-icon btn-sm"
            title="删除这条记录（不删除文件）"
            onClick={() => handleDeleteRecord(r)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => navigate("/bookshelf")}
            title="返回书架"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="page-title">下载历史</h1>
            <p className="page-subtitle">在本机下载过的书，按时间从新到旧</p>
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spinner" : ""} />
          刷新
        </button>
      </div>

      {records.length > 0 && (
        <div className="history-search">
          <Search size={16} className="history-search-icon" />
          <input
            className="search-input"
            placeholder={`在 ${records.length} 条记录中按书名、作者、格式筛选…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {error ? (
        <div className="empty-state">
          <History size={40} className="empty-state-icon" />
          <p className="empty-state-text">加载下载历史失败</p>
          <p className="empty-state-hint" style={{ userSelect: "text" }}>
            {error}
          </p>
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={load}>
            重试
          </button>
        </div>
      ) : loading && records.length === 0 ? (
        <div className="empty-state">
          <Loader2 size={40} className="spinner empty-state-icon" />
        </div>
      ) : records.length === 0 ? (
        <div className="empty-state">
          <History size={40} className="empty-state-icon" />
          <p className="empty-state-text">还没有下载记录</p>
          <p className="empty-state-hint">之后下载的书都会按时间记录在这里</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="empty-state">
          <Search size={40} className="empty-state-icon" />
          <p className="empty-state-text">没有匹配「{query.trim()}」的记录</p>
        </div>
      ) : (
        groups.map(([day, list]) => (
          <section key={day} className="history-group">
            <div className="history-group-title">
              {dayLabel(day)}
              <span className="history-group-count">{list.length}</span>
            </div>
            <div className="card" style={{ padding: 8 }}>
              {list.map(renderRecord)}
            </div>
          </section>
        ))
      )}

      {limitError && (
        <DownloadLimitDialog
          message={limitError}
          onSwitchAccount={() => window.dispatchEvent(new Event("olib:show-login"))}
          onClose={() => setLimitError(null)}
        />
      )}
    </div>
  );
}
