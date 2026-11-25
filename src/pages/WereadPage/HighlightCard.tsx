import { useEffect, useMemo, useState } from "react";
import { BookOpenText, Quote, Shuffle } from "lucide-react";
import SectionTitle, { SectionError } from "./SectionTitle";
import { wereadGetBookmarks, type WereadNotebookBook } from "../../api/weread";
import type { Loaded } from "./useLoad";

interface Props {
  notebooks: Loaded<WereadNotebookBook[]>;
  onOpenBook: (bookId: string) => void;
}

interface Line {
  text: string;
  bookId: string;
  title: string;
}

/** 参与「重温划线」的书：最近有划线的前 3 本 */
const SOURCE_BOOKS = 3;

/** 重温划线：从最近有笔记的几本书里随机取一句，可换一条 */
export default function HighlightCard({ notebooks, onOpenBook }: Props) {
  const sources = useMemo(
    () => (notebooks.data ?? []).filter((n) => n.noteCount > 0).slice(0, SOURCE_BOOKS),
    [notebooks.data],
  );
  const [lines, setLines] = useState<Line[] | null>(null);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (sources.length === 0) return;
    let alive = true;
    Promise.allSettled(sources.map((n) => wereadGetBookmarks(n.bookId))).then((results) => {
      if (!alive) return;
      const all: Line[] = [];
      results.forEach((r, i) => {
        if (r.status !== "fulfilled") return;
        for (const bm of r.value.updated ?? []) {
          const text = bm.markText?.trim();
          // 太短的划线（几个字）不适合做金句展示
          if (text && text.length >= 8) {
            all.push({ text, bookId: sources[i].bookId, title: sources[i].book.title });
          }
        }
      });
      const failed = results.find((r) => r.status === "rejected");
      if (all.length === 0 && failed) {
        setError(String((failed as PromiseRejectedResult).reason ?? "加载失败"));
        return;
      }
      setError("");
      setLines(all);
      setIndex(all.length > 0 ? Math.floor(Math.random() * all.length) : 0);
    });
    return () => {
      alive = false;
    };
  }, [sources, version]);

  let body;
  if ((notebooks.loading && !notebooks.data) || (sources.length > 0 && !lines && !error)) {
    body = <div className="wr-skeleton" style={{ flex: 1, minHeight: 150 }} />;
  } else if (error) {
    body = (
      <SectionError message={`划线加载失败：${error}`} onRetry={() => setVersion((v) => v + 1)} />
    );
  } else if (!lines || lines.length === 0) {
    body = <div className="wr-muted">还没有划线。在微信读书里划下喜欢的句子，这里会帮你重温。</div>;
  } else {
    const line = lines[index % lines.length];
    body = (
      <>
        <div className="wr-quote-mark">“</div>
        <div className="wr-quote-text">{line.text}</div>
        <div className="wr-quote-source">
          <span>—— 《{line.title}》</span>
          <button className="wr-link-btn" onClick={() => onOpenBook(line.bookId)}>
            <BookOpenText size={13} /> 看笔记
          </button>
          {lines.length > 1 && (
            <button
              className="wr-link-btn"
              onClick={() =>
                setIndex(
                  (i) => (i + 1 + Math.floor(Math.random() * (lines.length - 1))) % lines.length,
                )
              }
            >
              <Shuffle size={13} /> 换一条
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="wr-card wr-quote-card">
      <SectionTitle icon={<Quote size={18} />} title="重温划线" />
      {body}
    </div>
  );
}
