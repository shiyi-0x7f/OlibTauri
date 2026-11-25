import { useState, useEffect, useRef } from "react";
import {
  Download,
  CheckCircle2,
  XCircle,
  Loader2,
  Pause,
  Trash2,
  ExternalLink,
  ArrowRight,
  AlertTriangle,
  ChevronUp,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  getAllDownloads,
  cancelDownload,
  deleteDownload,
  type DownloadProgress,
  type DownloadStatus,
} from "../api/download";

/** 已完成 / 已转交的任务在面板里停留多久后隐藏（文件此时已出现在书架列表中） */
const FINISHED_LINGER_MS = 3000;

const STATUS_LABEL: Record<DownloadStatus, string> = {
  Pending: "等待中",
  Downloading: "下载中",
  Completed: "已完成",
  Failed: "失败",
  Cancelled: "已取消",
  Dispatched: "已转交",
};

const isActive = (s: DownloadStatus) => s === "Downloading" || s === "Pending";
/** 正常结束的任务：短暂展示后自动隐藏 */
const isFinished = (s: DownloadStatus) => s === "Completed" || s === "Dispatched";

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

function formatETA(downloaded: number, total: number, speedKbps: number): string {
  if (!total || !speedKbps || speedKbps < 0.1 || downloaded >= total) return "";
  const remainingSec = (total - downloaded) / (speedKbps * 1024);
  if (remainingSec < 60) return `剩余 ${Math.ceil(remainingSec)} 秒`;
  if (remainingSec < 3600) return `剩余 ${Math.ceil(remainingSec / 60)} 分钟`;
  const hours = Math.floor(remainingSec / 3600);
  const mins = Math.ceil((remainingSec % 3600) / 60);
  return `剩余 ${hours} 小时 ${mins} 分钟`;
}

function StatusIcon({ status }: { status: DownloadStatus }) {
  switch (status) {
    case "Completed":
      return <CheckCircle2 size={16} style={{ color: "var(--success)" }} />;
    case "Failed":
      return <XCircle size={16} style={{ color: "var(--error)" }} />;
    case "Cancelled":
      return <Pause size={16} style={{ color: "var(--warning)" }} />;
    case "Downloading":
      return <Loader2 size={16} className="spinner" style={{ color: "var(--accent)" }} />;
    case "Dispatched":
      return <ExternalLink size={16} style={{ color: "var(--accent-light)" }} />;
    default:
      return <Download size={16} style={{ color: "var(--text-muted)" }} />;
  }
}

function statusBadgeClass(status: DownloadStatus): string {
  switch (status) {
    case "Completed":
      return "badge-success";
    case "Failed":
      return "badge-error";
    case "Cancelled":
      return "badge-warning";
    default:
      return "badge-accent";
  }
}

interface DownloadQueueProps {
  /** 有任务下载完成时回调（书架据此刷新文件列表） */
  onCompleted: () => void;
}

/**
 * 书架底部的下载任务面板：没有任务时整块隐藏；有任务时显示一条摘要栏，点击展开列表。
 */
export default function DownloadQueue({ onCompleted }: DownloadQueueProps) {
  const [downloads, setDownloads] = useState<DownloadProgress[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(false);

  const onCompletedRef = useRef(onCompleted);
  useEffect(() => {
    onCompletedRef.current = onCompleted;
  });

  // 每秒轮询任务；只有本次挂载期间「刚结束」的任务才短暂展示，挂载前就已结束的直接隐藏
  useEffect(() => {
    const lastStatus = new Map<string, DownloadStatus>();
    const finishedAt = new Map<string, number>();
    let firstPoll = true;

    const poll = async () => {
      try {
        const tasks = await getAllDownloads();
        const now = Date.now();
        let completed = false;
        for (const t of tasks) {
          const prev = lastStatus.get(t.book_id);
          if (!isFinished(t.status)) {
            finishedAt.delete(t.book_id);
          } else if (!firstPoll && prev !== t.status) {
            finishedAt.set(t.book_id, now);
            if (t.status === "Completed") completed = true;
          }
          lastStatus.set(t.book_id, t.status);
        }
        firstPoll = false;

        const visible = tasks.filter(
          (t) =>
            !isFinished(t.status) || now - (finishedAt.get(t.book_id) ?? 0) < FINISHED_LINGER_MS,
        );
        setDownloads(visible);
        if (visible.length === 0) setExpanded(false);
        if (completed) onCompletedRef.current();
      } catch (err) {
        console.error("Failed to fetch downloads:", err);
      }
    };

    poll();
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleCancel = async (bookId: string) => {
    try {
      await cancelDownload(bookId);
      // 不立即删除——等下载循环检测到取消并把状态改为 Cancelled，用户再手动删
      toast.success("已取消下载");
    } catch (err) {
      console.error("Cancel failed:", err);
      toast.error("取消失败");
    }
  };

  const removeTasks = async (bookIds: string[]) => {
    try {
      await Promise.all(bookIds.map((id) => deleteDownload(id)));
      setDownloads((prev) => prev.filter((d) => !bookIds.includes(d.book_id)));
    } catch (err) {
      console.error("Delete failed:", err);
      toast.error("删除失败");
    }
  };

  if (downloads.length === 0) return null;

  const active = downloads.filter((d) => isActive(d.status));
  const failedCount = downloads.filter((d) => d.status === "Failed").length;
  const clearable = downloads.filter((d) => d.status === "Failed" || d.status === "Cancelled");
  const showFailedTip = failedCount > 0 && !tipDismissed;

  const summary = (
    [
      ["下载中", active.length],
      ["失败", failedCount],
      ["已取消", downloads.filter((d) => d.status === "Cancelled").length],
      ["已完成", downloads.filter((d) => d.status === "Completed").length],
      ["已转交", downloads.filter((d) => d.status === "Dispatched").length],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} ${n}`)
    .join(" · ");
  const totalSpeed = active.reduce((sum, d) => sum + d.speed_kbps, 0);
  const avgProgress = active.length
    ? active.reduce((sum, d) => sum + d.progress, 0) / active.length
    : 0;

  const handleGoToSettings = () => {
    window.dispatchEvent(new CustomEvent("olib:navigate", { detail: "/settings" }));
  };

  return (
    <div className={`download-queue ${expanded ? "download-queue-expanded" : ""}`}>
      <button className="download-queue-bar" onClick={() => setExpanded((v) => !v)}>
        {active.length > 0 ? (
          <Loader2 size={16} className="spinner" style={{ color: "var(--accent)" }} />
        ) : failedCount > 0 ? (
          <AlertTriangle size={16} style={{ color: "var(--warning)" }} />
        ) : (
          <CheckCircle2 size={16} style={{ color: "var(--success)" }} />
        )}
        <span className="download-queue-summary">{summary}</span>
        {active.length > 0 && (
          <>
            <span className="text-muted" style={{ fontSize: 12 }}>
              {totalSpeed.toFixed(1)} KB/s
            </span>
            <div className="progress-bar download-queue-mini-progress">
              <div className="progress-fill" style={{ width: `${avgProgress}%` }} />
            </div>
          </>
        )}
        <ChevronUp size={16} className="download-queue-chevron" />
      </button>

      {expanded && (
        <div className="download-queue-body">
          {showFailedTip && (
            <div className="download-queue-tip">
              <AlertTriangle size={16} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1 }}>
                <div className="download-queue-tip-title">有 {failedCount} 个下载失败</div>
                <div className="download-queue-tip-text">
                  下载速度过慢可能导致失败。试试前往{" "}
                  <strong style={{ color: "var(--text-secondary)" }}>设置 → 下载设置</strong>{" "}
                  切换下载方式（如浏览器、IDM 或 Motrix）。
                </div>
                <div className="flex gap-2" style={{ marginTop: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={handleGoToSettings}>
                    前往设置 <ArrowRight size={12} />
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setTipDismissed(true)}>
                    我知道了
                  </button>
                </div>
              </div>
            </div>
          )}

          {clearable.length > 1 && (
            <div className="flex" style={{ justifyContent: "flex-end", marginBottom: 4 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => removeTasks(clearable.map((d) => d.book_id))}
              >
                <Trash2 size={14} />
                清除失败/已取消
              </button>
            </div>
          )}

          {downloads.map((dl) => (
            <div key={dl.book_id} className="download-queue-item">
              <div className="flex items-center gap-3">
                <StatusIcon status={dl.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="file-name">{dl.title}</div>
                  <div className="file-meta download-queue-meta">
                    <span className={`badge ${statusBadgeClass(dl.status)}`}>
                      {STATUS_LABEL[dl.status]}
                    </span>
                    {dl.status === "Downloading" && (
                      <span className="text-muted">
                        {dl.speed_kbps.toFixed(1)} KB/s · {dl.progress.toFixed(1)}%
                        {dl.total_bytes
                          ? ` · ${formatSize(dl.downloaded_bytes || 0)}/${formatSize(dl.total_bytes)}`
                          : ""}
                        {dl.downloaded_bytes && dl.total_bytes && dl.speed_kbps > 0 ? (
                          <> · {formatETA(dl.downloaded_bytes, dl.total_bytes, dl.speed_kbps)}</>
                        ) : null}
                      </span>
                    )}
                    {dl.error && (
                      <span
                        style={{
                          color:
                            dl.status === "Dispatched" ? "var(--accent-light)" : "var(--error)",
                        }}
                      >
                        {dl.error}
                      </span>
                    )}
                  </div>
                </div>
                {isActive(dl.status) ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => handleCancel(dl.book_id)}>
                    取消
                  </button>
                ) : (
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => removeTasks([dl.book_id])}
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              {isActive(dl.status) && (
                <div className="progress-bar" style={{ marginTop: 10 }}>
                  <div className="progress-fill" style={{ width: `${dl.progress}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
