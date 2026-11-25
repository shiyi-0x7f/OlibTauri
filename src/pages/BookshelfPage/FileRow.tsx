import {
  CheckCircle2,
  ExternalLink,
  Folder,
  FolderOpen,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { FileInfo } from "../../api/bookshelf";
import type { PluginTask } from "../../api/plugin";
import type { ProcessMark } from "./usePluginProcessing";
import { displayName, formatSize, formatTone, relativeTime } from "./fileKinds";

interface FileRowProps {
  file: FileInfo;
  /** 该文件上运行中的插件任务 */
  task?: PluginTask;
  taskLabel?: string;
  marks: ProcessMark[];
  onOpen: (file: FileInfo) => void;
  onReveal: (file: FileInfo) => void;
  /** 打开操作菜单（右键 / 「更多」按钮共用），坐标为菜单左上角 */
  onMenu: (file: FileInfo, x: number, y: number) => void;
}

/** 书架列表的一行：格式色块 | 书名（+ 加工标记） | 修改时间 | 大小 | 悬停快捷操作 */
export default function FileRow({
  file,
  task,
  taskLabel,
  marks,
  onOpen,
  onReveal,
  onMenu,
}: FileRowProps) {
  const ext = file.extension.toUpperCase();
  const tone = file.is_dir ? "#f59e0b" : formatTone(file.extension);

  return (
    <div
      className="bs-row"
      onDoubleClick={() => onOpen(file)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(file, e.clientX, e.clientY);
      }}
      title={file.name}
    >
      <div
        className={`bs-format ${file.is_dir ? "is-dir" : ""} ${ext.length > 3 ? "is-long" : ""}`}
        style={{ "--bs-tone": tone } as React.CSSProperties}
      >
        {file.is_dir ? (
          <Folder size={16} fill="currentColor" />
        ) : (
          <span>{ext.slice(0, 4) || "?"}</span>
        )}
      </div>

      <div className="bs-row-main">
        <div className="bs-row-name">{displayName(file)}</div>
        {(task || marks.length > 0) && (
          <div className="bs-row-chips">
            {task && (
              <span className="bs-chip bs-chip-busy">
                <RefreshCw size={10} className="spinner" />
                {taskLabel}
                {task.progress > 0 && ` ${Math.round(task.progress)}%`}
              </span>
            )}
            {marks.map((m) => (
              <span
                key={m.label}
                className={`bs-chip ${m.tone === "done" ? "bs-chip-done" : "bs-chip-derived"}`}
                title={m.title}
              >
                {m.tone === "done" ? <CheckCircle2 size={10} /> : <Sparkles size={10} />}
                {m.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="bs-cell bs-cell-time" title={file.modified ?? undefined}>
        {relativeTime(file.modified)}
      </div>
      <div className="bs-cell bs-cell-size">{file.is_dir ? "—" : formatSize(file.size)}</div>

      <div className="bs-row-actions">
        <button
          className="btn btn-ghost btn-icon btn-sm"
          title={file.is_dir ? "打开文件夹" : "打开"}
          onClick={() => onOpen(file)}
        >
          <ExternalLink size={14} />
        </button>
        <button
          className="btn btn-ghost btn-icon btn-sm"
          title="在文件夹中显示"
          onClick={() => onReveal(file)}
        >
          <FolderOpen size={14} />
        </button>
        <button
          className="btn btn-ghost btn-icon btn-sm"
          title="更多操作（转换、OCR、导入微信读书…）"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onMenu(file, rect.right - 180, rect.bottom + 4);
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    </div>
  );
}
