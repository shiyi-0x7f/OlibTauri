import type { FileInfo } from "../../api/bookshelf";

/** 文件分类（筛选标签）：按扩展名归类，匹配不到的归「其他」 */
export const CATEGORIES: Record<string, Set<string>> = {
  电子书: new Set(["PDF", "EPUB", "MOBI", "AZW3", "AZW", "FB2", "DJVU", "CBZ", "CBR"]),
  文档: new Set([
    "DOC",
    "DOCX",
    "PPT",
    "PPTX",
    "XLS",
    "XLSX",
    "CSV",
    "TXT",
    "MD",
    "RTF",
    "ODT",
    "ODS",
    "ODP",
  ]),
  图片: new Set([
    "JPG",
    "JPEG",
    "PNG",
    "GIF",
    "BMP",
    "SVG",
    "WEBP",
    "AVIF",
    "TIFF",
    "TIF",
    "ICO",
    "PSD",
    "EPS",
  ]),
  音视频: new Set([
    "MP4",
    "MP3",
    "AVI",
    "MKV",
    "MOV",
    "WAV",
    "FLAC",
    "AAC",
    "OGG",
    "WMV",
    "WEBM",
    "M4A",
    "M4V",
  ]),
};

export const ALL = "全部";
export const FOLDERS = "文件夹";
export const OTHER = "其他";

/** 文件所属分类：文件夹 / 电子书 / 文档 / 图片 / 音视频 / 其他 */
export function categoryOf(file: FileInfo): string {
  if (file.is_dir) return FOLDERS;
  const ext = file.extension.toUpperCase();
  for (const [cat, exts] of Object.entries(CATEGORIES)) {
    if (exts.has(ext)) return cat;
  }
  return OTHER;
}

/** 格式色块的配色：同类格式同色，一眼区分 PDF / EPUB / Kindle 格式 */
const FORMAT_TONES: Record<string, string> = {
  pdf: "#ef4444",
  epub: "#22c55e",
  mobi: "#f59e0b",
  azw: "#f59e0b",
  azw3: "#f59e0b",
  txt: "#94a3b8",
  md: "#8b5cf6",
  doc: "#3b82f6",
  docx: "#3b82f6",
  rtf: "#3b82f6",
  odt: "#3b82f6",
  cbz: "#ec4899",
  cbr: "#ec4899",
  djvu: "#14b8a6",
  fb2: "#14b8a6",
};

export function formatTone(ext: string): string {
  return FORMAT_TONES[ext.toLowerCase()] ?? "var(--accent)";
}

export function formatSize(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  // 字节数不带小数；≥100 的数值小数位没有信息量
  const digits = i === 0 || size >= 100 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[i]}`;
}

/** 列表里显示的名字：去掉扩展名（格式色块上已经标了） */
export function displayName(file: FileInfo): string {
  if (file.is_dir || !file.extension) return file.name;
  const suffix = `.${file.extension}`;
  return file.name.toLowerCase().endsWith(suffix.toLowerCase())
    ? file.name.slice(0, -suffix.length)
    : file.name;
}

/** "YYYY-MM-DD HH:MM:SS"（本地时间）→ 「刚刚 / 5 分钟前 / 3 天前 / 2026-01-02」 */
export function relativeTime(modified: string | null | undefined): string {
  if (!modified) return "";
  const t = new Date(modified.replace(" ", "T")).getTime();
  if (Number.isNaN(t)) return modified;
  const minutes = Math.floor((Date.now() - t) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return modified.slice(0, 10);
}
