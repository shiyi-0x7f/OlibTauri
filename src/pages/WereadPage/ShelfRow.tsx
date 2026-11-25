import { useMemo } from "react";
import { Library } from "lucide-react";
import WereadCover from "../../components/WereadCover";
import SectionTitle from "./SectionTitle";
import type { Loaded } from "./useLoad";
import type { WereadShelf } from "../../api/weread";
import { useHorizontalWheel } from "./useHorizontalWheel";

interface Props {
  shelf: Loaded<WereadShelf>;
  onOpenBook: (bookId: string) => void;
}

const MAX_ITEMS = 24;

/** 我的书架：按最近阅读排序横排，封面下显示进度；书架加载失败由「继续阅读」统一提示 */
export default function ShelfRow({ shelf, onOpenBook }: Props) {
  const books = useMemo(
    () =>
      (shelf.data?.books ?? [])
        .filter((b) => !b.secret)
        .sort((a, b) => (b.readUpdateTime ?? 0) - (a.readUpdateTime ?? 0)),
    [shelf.data],
  );
  const progress = useMemo(
    () => new Map((shelf.data?.bookProgress ?? []).map((p) => [p.bookId, p.progress ?? 0])),
    [shelf.data],
  );

  const scrollRef = useHorizontalWheel(books.length > 0);

  if (!shelf.data || books.length === 0) return null;

  return (
    <section>
      <SectionTitle
        icon={<Library size={18} />}
        title="我的书架"
        sub={`共 ${books.length} 本 · 按最近阅读`}
      />
      <div className="wr-hscroll" ref={scrollRef} tabIndex={0} aria-label="我的书架书籍">
        {books.slice(0, MAX_ITEMS).map((b) => {
          const p = Math.min(100, Math.max(0, progress.get(b.bookId) ?? 0));
          return (
            <button key={b.bookId} className="wr-shelf-item" onClick={() => onOpenBook(b.bookId)}>
              <WereadCover src={b.cover} title={b.title}>
                {b.finishReading ? <span className="wr-badge-done">读完</span> : null}
              </WereadCover>
              <div className="wr-shelf-title" title={b.title}>
                {b.title}
              </div>
              <div className="wr-shelf-progress">
                <div className="wr-shelf-progress-track">
                  <div style={{ width: `${b.finishReading ? 100 : p}%` }} />
                </div>
                {b.finishReading ? "100%" : `${p}%`}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
