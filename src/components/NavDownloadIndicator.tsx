import { useState, useEffect } from "react";
import { ArrowDown } from "lucide-react";
import { getAllDownloads, type DownloadProgress } from "../api/download";

const POLL_MS = 1500;

/** 侧边栏「书架」旁的下载中标识：有任务在下载 / 排队时显示下落箭头动画，多本时附数量 */
export default function NavDownloadIndicator() {
  const [active, setActive] = useState<DownloadProgress[]>([]);

  useEffect(() => {
    const poll = async () => {
      try {
        const tasks = await getAllDownloads();
        setActive(tasks.filter((t) => t.status === "Downloading" || t.status === "Pending"));
      } catch (err) {
        console.error("Failed to poll downloads for nav indicator:", err);
      }
    };
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  if (active.length === 0) return null;

  const avg = Math.round(active.reduce((sum, t) => sum + t.progress, 0) / active.length);
  const label = `正在下载 ${active.length} 本 · ${avg}%`;

  return (
    <span className="nav-download-indicator" title={label} aria-label={label} role="status">
      <span className="nav-download-arrow">
        <ArrowDown size={12} strokeWidth={2.5} />
      </span>
      {active.length > 1 && <span>{active.length}</span>}
    </span>
  );
}
