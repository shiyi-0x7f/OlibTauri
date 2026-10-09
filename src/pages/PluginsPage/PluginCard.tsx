import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileCog,
  FileText,
  Globe,
  Languages,
  Loader2,
  Puzzle,
  Repeat,
  RotateCcw,
  ScanText,
  ShieldCheck,
  Trash2,
  Wand2,
} from "lucide-react";
import type { PluginActionInfo, PluginStatus } from "../../api/plugin";
import type { EngineInfo } from "../../api/convert";
import { formatBytes, formatSpeed } from "./format";

const CAPABILITY_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  convert: Repeat,
  ocr: ScanText,
  "pdf-tools": Wand2,
  "doc-convert": FileText,
  "text-tools": Languages,
};

/** "PDF / EPUB / MOBI / AZW3 等 12 种" */
function formatList(list: string[]): string {
  const head = list
    .slice(0, 4)
    .map((f) => f.toUpperCase())
    .join(" / ");
  return list.length > 4 ? `${head} 等 ${list.length} 种` : head;
}

interface PluginCardProps {
  plugin: PluginStatus;
  /** 该插件声明的一键动作 */
  actions: PluginActionInfo[];
  /** 转换引擎探测结果（仅 convert 插件用来判断「用户已自行安装」） */
  engine: EngineInfo | null;
  /** 用户手动指定的 Calibre 路径（空 = 自动检测） */
  calibrePath: string;
  tone: string;
  /** 磁盘占用；未安装为 undefined */
  sizeBytes?: number;
  expanded: boolean;
  onToggle: () => void;
  onInstall: (id: string) => void;
  onUninstall: (plugin: PluginStatus) => void;
  onSetCalibrePath: (path: string) => void;
}

/** 可展开的插件条目：收起时一行简略信息（状态 / 占用 / 主操作），展开看详情与全部操作 */
export default function PluginCard({
  plugin: p,
  actions,
  engine,
  calibrePath,
  tone,
  sizeBytes,
  expanded,
  onToggle,
  onInstall,
  onUninstall,
  onSetCalibrePath,
}: PluginCardProps) {
  const Icon = CAPABILITY_ICONS[p.capability] || Puzzle;
  const installing =
    p.phase === "Downloading" || p.phase === "Verifying" || p.phase === "Installing";
  const installed = p.phase === "Installed";
  // 转换引擎特有：用户可能自行装了 Calibre，此时无需插件
  const external = p.capability === "convert" && !installed && !!engine?.available;
  const canInstall = !installed && !installing && p.supported;

  const status = installing
    ? {
        cls: "pl-status-busy",
        icon: <Loader2 size={11} className="spinner" />,
        label: p.phase === "Installing" ? "安装中" : p.phase === "Verifying" ? "校验中" : "下载中",
      }
    : installed || external
      ? { cls: "pl-status-installed", icon: <CheckCircle2 size={11} />, label: "已安装" }
      : p.phase === "Failed"
        ? { cls: "pl-status-failed", icon: <AlertTriangle size={11} />, label: "安装失败" }
        : { cls: "pl-status-idle", icon: null, label: "未安装" };

  const progressText =
    p.phase === "Installing"
      ? "正在解压安装…"
      : p.phase === "Verifying"
        ? "正在校验完整性…"
        : `${formatBytes(p.downloaded_bytes)}${p.total_bytes > 0 ? ` / ${formatBytes(p.total_bytes)}` : ""}`;

  const pickCalibre = async () => {
    const selected = await open({ title: "选择 ebook-convert 可执行文件" });
    if (typeof selected === "string") onSetCalibrePath(selected);
  };

  const installButton = canInstall && (
    <button
      className={`btn btn-sm ${external ? "btn-secondary" : "btn-primary"}`}
      onClick={(e) => {
        e.stopPropagation();
        onInstall(p.id);
      }}
    >
      <Download size={14} />
      {p.phase === "Failed" ? "重试" : external ? "仍然下载" : "安装"}
    </button>
  );

  return (
    <div
      className={`card pl-item ${expanded ? "is-expanded" : ""}`}
      style={{ "--pl-tone": tone } as React.CSSProperties}
    >
      <div
        className="pl-item-head"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="pl-icon">
          <Icon size={18} />
        </div>
        <div className="pl-item-main">
          <div className="pl-item-title">
            {p.name}
            {p.origin !== "Builtin" && (
              <span className="pl-tag">
                <Globe size={10} /> 第三方
              </span>
            )}
          </div>
          {installing ? (
            <div className="pl-item-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: p.phase === "Downloading" ? `${p.progress}%` : "100%" }}
                />
              </div>
              <span>{progressText}</span>
            </div>
          ) : (
            <div className="pl-item-summary">{p.description}</div>
          )}
        </div>
        {sizeBytes !== undefined && <span className="pl-item-size">{formatBytes(sizeBytes)}</span>}
        <span className={`pl-status ${status.cls}`}>
          {status.icon}
          {status.label}
        </span>
        {installButton}
        <ChevronDown size={16} className="pl-chevron" />
      </div>

      {expanded && (
        <div className="pl-item-body">
          <div className="pl-desc">{p.description}</div>

          <div className="pl-tags">
            {p.origin === "Builtin" ? (
              <span className="pl-tag pl-tag-accent">
                <ShieldCheck size={11} /> 官方
              </span>
            ) : (
              <span className="pl-tag">
                <Globe size={11} /> 第三方
              </span>
            )}
            {[p.publisher, p.license].filter(Boolean).length > 0 && (
              <span className="pl-tag">{[p.publisher, p.license].filter(Boolean).join(" · ")}</span>
            )}
            {/* 装了能干什么：把清单声明的动作直接列出来 */}
            {actions.map((a) => (
              <span key={a.action_id} className="pl-tag" title={a.description}>
                <Wand2 size={11} /> {a.name}
              </span>
            ))}
          </div>

          {p.inputs.length > 0 && p.outputs.length > 0 && (
            <div className="pl-formats">
              <strong>{formatList(p.inputs)}</strong> → <strong>{formatList(p.outputs)}</strong>
            </div>
          )}

          {installing ? (
            p.phase === "Downloading" &&
            p.source && (
              <div className="pl-info">
                下载源：{p.source}
                {formatSpeed(p.speed_kbps) && ` · ${formatSpeed(p.speed_kbps)}`}
              </div>
            )
          ) : p.phase === "Failed" && p.error ? (
            <div className="pl-error">
              <AlertTriangle size={14} />
              <span>{p.error}</span>
            </div>
          ) : installed ? (
            <div className="pl-engine-path" title={p.engine_path}>
              {p.engine_path}
            </div>
          ) : external ? (
            <div className="pl-info">
              已检测到你自行安装的 {engine?.version || "引擎"}，直接使用，无需下载插件。
              <div className="pl-engine-path">{engine?.path}</div>
            </div>
          ) : (
            <div className="pl-info">
              {p.supported
                ? "首次使用需下载，之后离线可用。优先走国内加速源，慢或失败会自动换源。"
                : "当前系统不支持一键安装，请自行安装对应工具，安装后会被自动检测。"}
            </div>
          )}

          <div className="pl-item-actions">
            {p.capability === "convert" && !installing && (
              <button className="btn btn-ghost btn-sm" onClick={pickCalibre}>
                <FileCog size={14} /> 指定已有路径
              </button>
            )}
            {p.capability === "convert" && calibrePath && !installing && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onSetCalibrePath("")}
                title={`当前指定：${calibrePath}`}
              >
                <RotateCcw size={14} /> 恢复自动检测
              </button>
            )}
            {p.homepage && (
              <button className="btn btn-ghost btn-sm" onClick={() => openUrl(p.homepage)}>
                <ExternalLink size={14} /> 项目主页
              </button>
            )}
            {installed && (
              <button
                className="btn btn-ghost btn-sm pl-btn-uninstall"
                onClick={() => onUninstall(p)}
              >
                <Trash2 size={14} /> 卸载
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
