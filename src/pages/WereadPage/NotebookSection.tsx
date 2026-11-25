import { useMemo, useState } from "react";
import { FileDown, Loader2, NotebookPen, Search, X } from "lucide-react";
import WereadCover from "../../components/WereadCover";
import { searchInLibrary } from "../../utils/searchInLibrary";
import SectionTitle, { SectionError } from "./SectionTitle";
import { useExportAllNotes } from "./useExportAllNotes";
import type { Loaded } from "./useLoad";
import type { WereadNotebookBook } from "../../api/weread";

interface Props {
  notebooks: Loaded<WereadNotebookBook[]>;
  onRetry: () => void;
  onOpenBook: (bookId: string) => void;
}

const COLLAPSED = 12;

/** 笔记：可按书名 / 作者筛选，卡片网格；导出全部笔记为 Markdown */
export default function NotebookSection({ notebooks, onRetry, onOpenBook }: Props) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const { exportAll, progress } = useExportAllNotes();
  const all = useMemo(() => notebooks.data ?? [], [notebooks.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (n) =>
        n.book.title.toLowerCase().includes(q) || (n.book.author ?? "").toLowerCase().includes(q),
    );
  }, [all, query]);
  const visible = showAll || query ? filtered : filtered.slice(0, COLLAPSED);

  const trailing = all.length > 0 && (
    <>
      <label className="wr-search">
        <Search size={13} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="筛选书名或作者"
        />
        {query && <X size={13} style={{ cursor: "pointer" }} onClick={() => setQuery("")} />}
      </label>
      <button
        className="wr-pill-btn"
        disabled={!!progress}
        onClick={() => exportAll(all)}
        title="将所有书的划线和想法导出为 Markdown 文件"
      >
        {progress ? (
          <>
            <Loader2 size={13} className="spin" /> 导出中 {progress.current}/{progress.total}
          </>
        ) : (
          <>
            <FileDown size={13} /> 导出全部
          </>
        )}
      </button>
    </>
  );

  let body;
  if (notebooks.loading && !notebooks.data) {
    body = (
      <div className="wr-notes-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="wr-skeleton" style={{ height: 96, borderRadius: 16 }} />
        ))}
      </div>
    );
  } else if (notebooks.error && !notebooks.data) {
    body = <SectionError message={`笔记加载失败：${notebooks.error}`} onRetry={onRetry} />;
  } else if (all.length === 0) {
    body = <div className="wr-muted">还没有笔记。在微信读书里划线或写想法后，会出现在这里。</div>;
  } else if (filtered.length === 0) {
    body = <div className="wr-muted">没有匹配「{query}」的书</div>;
  } else {
    body = (
      <>
        <div className="wr-notes-grid">
          {visible.map((nb) => (
            <div key={nb.bookId} className="wr-note-card" onClick={() => onOpenBook(nb.bookId)}>
              <WereadCover src={nb.book.cover} title={nb.book.title} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="wr-note-title">{nb.book.title}</div>
                {nb.book.author && <div className="wr-note-author">{nb.book.author}</div>}
                <div className="wr-note-chips">
                  <span className="wr-chip accent">划线 {nb.noteCount}</span>
                  <span className="wr-chip">想法 {nb.reviewCount}</span>
                  {(nb.readingProgress ?? 0) > 0 && (
                    <span className="wr-chip">已读 {nb.readingProgress}%</span>
                  )}
                </div>
              </div>
              <button
                className="wr-icon-btn"
                title="去 Z 站搜索电子书"
                onClick={(e) => {
                  e.stopPropagation();
                  searchInLibrary(nb.book.title);
                }}
              >
                <Search size={14} />
              </button>
            </div>
          ))}
        </div>
        {!query && filtered.length > COLLAPSED && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
            <button className="wr-pill-btn" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "收起" : `查看全部 ${filtered.length} 本`}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <section>
      <SectionTitle
        icon={<NotebookPen size={18} />}
        title="笔记"
        sub={all.length > 0 ? `${all.length} 本书` : undefined}
        trailing={trailing}
      />
      {body}
    </section>
  );
}
