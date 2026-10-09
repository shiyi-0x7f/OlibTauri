// 微信读书笔记导出：将划线/想法组织为 Markdown（Obsidian 友好）

export interface ExportChapter {
  chapterUid: number;
  chapterIdx: number;
  title: string;
}

export interface ExportBookmark {
  bookmarkId: string;
  chapterUid?: number;
  range?: string;
  markText: string;
  createTime?: number;
}

export interface ExportReview {
  reviewId: string;
  content: string;
  createTime?: number;
  chapterName?: string;
  abstract_?: string;
}

export interface ExportBookMeta {
  title: string;
  author?: string;
  publisher?: string;
  isbn?: string;
  category?: string;
  intro?: string;
}

// Windows 文件名非法字符替换
export function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim()
      .slice(0, 100) || "未命名"
  );
}

function formatDate(ts?: number): string {
  const d = ts ? new Date(ts * 1000) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeStart(range?: string): number {
  const n = parseInt((range || "").split("-")[0], 10);
  return Number.isNaN(n) ? 0 : n;
}

export function buildNotesMarkdown(
  meta: ExportBookMeta,
  chapters: ExportChapter[],
  bookmarks: ExportBookmark[],
  reviews: ExportReview[],
): string {
  const lines: string[] = [];

  lines.push(`# ${meta.title}`);
  lines.push("");
  const metaItems: string[] = [];
  if (meta.author) metaItems.push(`- 作者：${meta.author}`);
  if (meta.publisher) metaItems.push(`- 出版社：${meta.publisher}`);
  if (meta.isbn) metaItems.push(`- ISBN：${meta.isbn}`);
  if (meta.category) metaItems.push(`- 分类：${meta.category}`);
  metaItems.push(
    `- 导出：${formatDate()}（划线 ${bookmarks.length} 条 · 想法 ${reviews.length} 条 · 来自微信读书）`,
  );
  lines.push(...metaItems);
  lines.push("");

  if (meta.intro) {
    lines.push(`> [!abstract] 简介`);
    lines.push(`> ${meta.intro.replace(/\n+/g, " ")}`);
    lines.push("");
  }

  // ── 划线：按章节分组，章节按目录顺序，章内按原文位置排序 ──
  if (bookmarks.length > 0) {
    lines.push("## 划线");
    lines.push("");

    const sortedChapters = [...chapters].sort((a, b) => a.chapterIdx - b.chapterIdx);
    const byChapter = new Map<number, ExportBookmark[]>();
    const orphans: ExportBookmark[] = [];
    for (const bm of bookmarks) {
      if (bm.chapterUid != null && sortedChapters.some((c) => c.chapterUid === bm.chapterUid)) {
        const list = byChapter.get(bm.chapterUid) || [];
        list.push(bm);
        byChapter.set(bm.chapterUid, list);
      } else {
        orphans.push(bm);
      }
    }

    const renderGroup = (title: string, items: ExportBookmark[]) => {
      lines.push(`### ${title}`);
      lines.push("");
      for (const bm of items.sort((a, b) => rangeStart(a.range) - rangeStart(b.range))) {
        lines.push(`> ${bm.markText.replace(/\n+/g, " ")}`);
        lines.push("");
      }
    };

    for (const ch of sortedChapters) {
      const items = byChapter.get(ch.chapterUid);
      if (items && items.length > 0) renderGroup(ch.title, items);
    }
    if (orphans.length > 0) renderGroup("其他", orphans);
  }

  // ── 想法：按时间排序，附原文引用 ──
  if (reviews.length > 0) {
    lines.push("## 想法");
    lines.push("");
    const sorted = [...reviews].sort((a, b) => (a.createTime || 0) - (b.createTime || 0));
    for (const r of sorted) {
      if (r.abstract_) {
        lines.push(`> ${r.abstract_.replace(/\n+/g, " ")}`);
        lines.push("");
      }
      lines.push(r.content);
      const footer = [r.chapterName, r.createTime ? formatDate(r.createTime) : ""]
        .filter(Boolean)
        .join(" · ");
      if (footer) lines.push(`<small>— ${footer}</small>`);
      lines.push("");
    }
  }

  if (bookmarks.length === 0 && reviews.length === 0) {
    lines.push("（本书暂无划线和想法）");
    lines.push("");
  }

  return lines.join("\n");
}
