import { BookOpen, ExternalLink, FolderOpen, Repeat, ScanText, Trash2, Wand2 } from "lucide-react";
import type { ContextMenuItem } from "../../components/ContextMenu";
import type { FileInfo } from "../../api/bookshelf";
import type { PluginActionInfo } from "../../api/plugin";
import { canImportToWeread } from "../../hooks/useWereadImport";

export interface FileMenuContext {
  /** 该文件是否有插件任务在跑（跑着的时候加工类操作置灰） */
  busy: boolean;
  convertible: boolean;
  ocrSupported: boolean;
  alreadyOcred: boolean;
  wereadUploading: boolean;
  actions: PluginActionInfo[];
  onOpen: () => void;
  onReveal: () => void;
  onConvert: () => void;
  onOcr: () => void;
  onImportWeread: () => void;
  onAction: (action: PluginActionInfo) => void;
  onDelete: () => void;
}

/** 文件的操作菜单（右键与「更多」按钮共用）。插件动作由清单驱动，新增插件不需要改这里 */
export function buildFileMenu(file: FileInfo, ctx: FileMenuContext): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { label: "打开文件", icon: <ExternalLink size={15} />, onClick: ctx.onOpen },
    { label: "在文件夹中显示", icon: <FolderOpen size={15} />, onClick: ctx.onReveal },
  ];

  if (!file.is_dir) {
    const processing: ContextMenuItem[] = [];
    if (ctx.convertible) {
      processing.push({
        label: ctx.busy ? "处理中…" : "转换格式",
        icon: <Repeat size={15} />,
        onClick: ctx.onConvert,
        disabled: ctx.busy,
      });
    }
    if (ctx.ocrSupported) {
      processing.push({
        label: ctx.busy ? "处理中…" : ctx.alreadyOcred ? "重新 OCR 识别" : "OCR 识别（可搜索 PDF）",
        icon: <ScanText size={15} />,
        onClick: ctx.onOcr,
        disabled: ctx.busy,
      });
    }
    if (canImportToWeread(file.extension)) {
      const tooLarge = !canImportToWeread(file.extension, file.size);
      processing.push({
        label: tooLarge
          ? "导入到微信读书（超过 200 MB）"
          : ctx.wereadUploading
            ? "正在导入微信读书…"
            : "导入到微信读书",
        icon: <BookOpen size={15} />,
        onClick: ctx.onImportWeread,
        disabled: tooLarge || ctx.wereadUploading,
      });
    }
    const ext = file.extension.toLowerCase();
    for (const action of ctx.actions.filter((a) => a.inputs.includes(ext))) {
      processing.push({
        label: ctx.busy ? "处理中…" : action.name,
        icon: <Wand2 size={15} />,
        onClick: () => ctx.onAction(action),
        disabled: ctx.busy,
      });
    }
    if (processing.length) {
      items.push({ label: "", onClick: () => {}, divider: true }, ...processing);
    }
  }

  items.push(
    { label: "", onClick: () => {}, divider: true },
    { label: "删除", icon: <Trash2 size={15} />, onClick: ctx.onDelete, danger: true },
  );
  return items;
}
