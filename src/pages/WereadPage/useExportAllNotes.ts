import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import toast from "react-hot-toast";
import { warnIgnored } from "../../utils/log";
import { buildNotesMarkdown, sanitizeFilename, type ExportReview } from "../../utils/wereadExport";
import {
  wereadGetBookmarks,
  wereadGetChapters,
  wereadGetMyReviews,
  wereadSaveNotes,
  type WereadNotebookBook,
} from "../../api/weread";

/** 把所有书的划线与想法逐本导出为 Markdown 到用户选择的目录 */
export function useExportAllNotes() {
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const exportAll = async (notebooks: WereadNotebookBook[]) => {
    if (notebooks.length === 0 || progress) return;
    const dir = await open({ directory: true, title: "选择笔记导出目录" });
    if (!dir) return;

    const failed: string[] = [];
    for (let i = 0; i < notebooks.length; i++) {
      const nb = notebooks[i];
      setProgress({ current: i + 1, total: notebooks.length });
      try {
        const [chaptersData, bookmarksData, reviewsData] = await Promise.all([
          wereadGetChapters(nb.bookId).catch(warnIgnored("weread_get_chapters")),
          wereadGetBookmarks(nb.bookId).catch(warnIgnored("weread_get_bookmarks")),
          wereadGetMyReviews(nb.bookId).catch(warnIgnored("weread_get_my_reviews")),
        ]);
        // 条目可能是 { review } 包装或直接平铺（见 api/weread WereadReviewItem 注释）
        const reviews = (reviewsData?.reviews || []).map((r) => (r.review || r) as ExportReview);
        const md = buildNotesMarkdown(
          { title: nb.book.title, author: nb.book.author },
          chaptersData?.chapters || [],
          bookmarksData?.updated || [],
          reviews,
        );
        await wereadSaveNotes(`${dir}/${sanitizeFilename(nb.book.title)}.md`, md);
      } catch (err) {
        warnIgnored(`weread_export:${nb.book.title}`)(err);
        failed.push(nb.book.title);
      }
    }
    setProgress(null);

    if (failed.length === 0) {
      toast.success(`已导出 ${notebooks.length} 本书的笔记`, { icon: "📝" });
    } else {
      toast.error(
        `导出完成：成功 ${notebooks.length - failed.length} 本，失败 ${failed.length} 本（${failed.slice(0, 3).join("、")}${failed.length > 3 ? " 等" : ""}）`,
        { duration: 8000 },
      );
    }
  };

  return { exportAll, progress };
}
