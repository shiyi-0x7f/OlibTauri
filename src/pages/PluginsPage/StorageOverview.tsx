import { useState } from "react";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  FolderCog,
  FolderOpen,
  HardDrive,
  Loader2,
  MapPin,
  RotateCcw,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  setPluginsLocation,
  openPluginsLocation,
  type PluginsLocation,
  type PluginsUsage,
} from "../../api/plugin";
import { formatBytes } from "./format";

interface StorageOverviewProps {
  location: PluginsLocation | null;
  onLocationChange: (location: PluginsLocation) => void;
  usage: PluginsUsage | null;
  usageLoading: boolean;
  installedCount: number;
  totalCount: number;
  /** 插件主题色（与卡片一致） */
  toneOf: (pluginId: string) => string;
  /** 位置变更后回调（插件页据此刷新安装状态） */
  onRelocated: () => void;
}

/** 插件页顶部：左侧占用空间（总量 + 分段条），右侧安装位置（查看 / 更改 / 恢复默认 / 打开） */
export default function StorageOverview({
  location,
  onLocationChange,
  usage,
  usageLoading,
  installedCount,
  totalCount,
  toneOf,
  onRelocated,
}: StorageOverviewProps) {
  const [relocating, setRelocating] = useState(false);

  const relocate = async (path: string | null) => {
    if (installedCount > 0) {
      const confirmed = await confirm(
        `已安装的 ${installedCount} 个插件会迁移到新位置。跨磁盘迁移需要复制文件，可能要等一会儿。`,
        { title: "更改插件安装位置", kind: "info", okLabel: "迁移", cancelLabel: "取消" },
      );
      if (!confirmed) return;
    }
    setRelocating(true);
    try {
      const report = await setPluginsLocation(path);
      onLocationChange(report.location);
      const parts = [];
      if (report.moved.length) parts.push(`已迁移：${report.moved.join("、")}`);
      if (report.kept.length) parts.push(`新位置已有、未迁移：${report.kept.join("、")}`);
      toast.success(["插件安装位置已更改", ...parts].join("；"), { duration: 5000 });
      onRelocated();
    } catch (err) {
      console.error("Failed to relocate plugins:", err);
      toast.error(String(err), { duration: 8000 });
    } finally {
      setRelocating(false);
    }
  };

  const handlePick = async () => {
    const selected = await open({
      title: "选择插件安装位置（建议使用专用的空文件夹）",
      directory: true,
      defaultPath: location?.path,
    });
    if (typeof selected === "string") relocate(selected);
  };

  const handleOpen = async () => {
    try {
      await openPluginsLocation();
    } catch (err) {
      toast.error(String(err), { duration: 6000 });
    }
  };

  return (
    <div className="card pl-overview">
      <section className="pl-overview-section">
        <div className="pl-section-label">
          <HardDrive size={14} /> 占用空间
          {usageLoading && <Loader2 size={12} className="spinner" />}
        </div>
        <div className="pl-usage-total">
          <span className="pl-usage-number">
            {usage ? (usage.total_bytes ? formatBytes(usage.total_bytes) : "0 MB") : "—"}
          </span>
          <span className="pl-usage-sub">
            已安装 {installedCount} / {totalCount} 个插件
          </span>
        </div>
        <div className="pl-usage-bar">
          {usage?.plugins.map((p) => (
            <div
              key={p.id}
              className="pl-usage-seg"
              style={{ flexGrow: p.bytes, background: toneOf(p.id) }}
              title={`${p.name} ${formatBytes(p.bytes)}`}
            />
          ))}
        </div>
        {usage && usage.plugins.length > 0 ? (
          <div className="pl-usage-legend">
            {usage.plugins.map((p) => (
              <span key={p.id} className="pl-legend-item">
                <span className="pl-legend-dot" style={{ background: toneOf(p.id) }} />
                {p.name}
                <span className="pl-legend-size">{formatBytes(p.bytes)}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="pl-usage-legend">
            {usage ? "还没有安装插件，不占用空间" : "正在统计…"}
          </div>
        )}
      </section>

      <section className="pl-overview-section">
        <div className="pl-section-label">
          <MapPin size={14} /> 安装位置
          {location?.is_default && <span className="badge">默认</span>}
        </div>
        <div className="pl-path" title={location?.path}>
          {location?.path ?? "…"}
        </div>

        {location && location.warnings.length > 0 && (
          <div className="pl-warning">
            <AlertTriangle size={14} />
            <div>
              {location.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
              <div>建议换一个更短的路径，例如 D:\OlibPlugins。</div>
            </div>
          </div>
        )}

        <div className="pl-btn-row">
          <button
            className="btn btn-secondary btn-sm"
            onClick={handlePick}
            disabled={relocating || !location}
          >
            {relocating ? <Loader2 size={14} className="spinner" /> : <FolderCog size={14} />}
            {relocating ? "正在迁移插件…" : "更改位置"}
          </button>
          {location && !location.is_default && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => relocate(null)}
              disabled={relocating}
              title={location.default_path}
            >
              <RotateCcw size={14} /> 恢复默认
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleOpen} disabled={relocating}>
            <FolderOpen size={14} /> 打开文件夹
          </button>
        </div>
      </section>
    </div>
  );
}
