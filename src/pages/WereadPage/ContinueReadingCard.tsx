import { useMemo } from "react";
import { BookOpenText, ExternalLink, Search } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import WereadCover from "../../components/WereadCover";
import { searchInLibrary } from "../../utils/searchInLibrary";
import { warnIgnored } from "../../utils/log";
import { formatDuration } from "./format";
import { SectionError } from "./SectionTitle";
import type { Loaded } from "./useLoad";
import type { WereadShelf, WereadShelfBook } from "../../api/weread";

interface Props {
  shelf: Loaded<WereadShelf>;
  onRetry: () => void;
  onOpenBook: (bookId: string) => void;
}

/** 最近在读（未读完、非私密、按最近阅读时间） */
export function recentReading(shelf: WereadShelf | null): WereadShelfBook[] {
  return (shelf?.books ?? [])
    .filter((b) => !b.secret && !b.finishReading && (b.readUpdateTime ?? 0) > 0)
    .sort((a, b) => (b.readUpdateTime ?? 0) - (a.readUpdateTime ?? 0));
}

/** 继续阅读：最近在读的一本 + 右侧再列几本最近读过的 */
export default function ContinueReadingCard({ shelf, onRetry, onOpenBook }: Props) {
  const recent = useMemo(() => recentReading(shelf.data), [shelf.data]);
  const progress = useMemo(
    () => new Map((shelf.data?.bookProgress ?? []).map((p) => [p.bookId, p])),
    [shelf.data],
  );

  if (shelf.loading && !shelf.data) {
    return <div className="wr-skeleton" style={{ minHeight: 210, borderRadius: 22 }} />;
  }
  if (shelf.error && !shelf.data) {
    return (
      <div className="wr-card">
        <SectionError message={`书架加载失败：${shelf.error}`} onRetry={onRetry} />
      </div>
    );
  }

  const book = recent[0];
  if (!book) {
    return (
      <div className="wr-hero" style={{ alignItems: "center" }}>
        <div className="wr-hero-body">
          <div className="wr-hero-eyebrow">继续阅读</div>
          <div className="wr-hero-title">书架里还没有在读的书</div>
          <div className="wr-hero-author">在微信读书开始读一本，这里会帮你接着上次的进度</div>
        </div>
      </div>
    );
  }

  const p = progress.get(book.bookId);
  const percent = Math.min(100, Math.max(0, p?.progress ?? 0));

  return (
    <div className="wr-hero">
      <WereadCover src={book.cover} title={book.title} onClick={() => onOpenBook(book.bookId)} />
      <div className="wr-hero-body">
        <div className="wr-hero-eyebrow">继续阅读 · 接着上次的进度</div>
        <div className="wr-hero-title">{book.title}</div>
        {book.author && <div className="wr-hero-author">{book.author}</div>}
        <div className="wr-hero-progress">
          <div className="wr-hero-progress-track">
            <div style={{ width: `${percent}%` }} />
          </div>
          <span>已读 {percent}%</span>
          {(p?.readingTime ?? 0) > 0 && <span>· 读了 {formatDuration(p?.readingTime ?? 0)}</span>}
        </div>
        <div className="wr-hero-actions">
          {book.deepLink && (
            <button
              className="wr-hero-btn primary"
              onClick={() => openUrl(book.deepLink!).catch(warnIgnored("weread_open_deeplink"))}
            >
              <ExternalLink size={14} /> 去微信读书继续读
            </button>
          )}
          <button className="wr-hero-btn ghost" onClick={() => onOpenBook(book.bookId)}>
            <BookOpenText size={14} /> 笔记与详情
          </button>
          <button className="wr-hero-btn ghost" onClick={() => searchInLibrary(book.title)}>
            <Search size={14} /> 找电子书
          </button>
        </div>
      </div>
      {recent.length > 1 && (
        <div className="wr-hero-recent">
          <div className="wr-hero-recent-label">也在读</div>
          {recent.slice(1, 4).map((b) => (
            <WereadCover
              key={b.bookId}
              src={b.cover}
              title={b.title}
              onClick={() => onOpenBook(b.bookId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
