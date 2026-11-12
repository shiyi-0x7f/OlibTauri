import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import WereadBookCard from "./WereadBookCard";
import { wereadSimilarBooks, type WereadBookInfo } from "../api/weread";

interface Props {
  bookId: string;
  onOpenBook: (bookId: string) => void;
}

interface Cursor {
  nextIdx: number;
  sessionId: string | null;
  hasMore: boolean;
}

const FIRST_PAGE: Cursor = { nextIdx: 0, sessionId: null, hasMore: true };

/** 详情弹窗「相似书」：/book/detailinfo listtypes=2 分页，点「加载更多」续页 */
export default function WereadSimilarBooks({ bookId, onOpenBook }: Props) {
  const [books, setBooks] = useState<WereadBookInfo[]>([]);
  const [cursor, setCursor] = useState<Cursor>(FIRST_PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 切换书籍后丢弃旧书的在途响应
  const owner = useRef(bookId);

  const loadPage = useCallback(
    async (from: Cursor, reset: boolean) => {
      const forBook = bookId;
      setLoading(true);
      setError("");
      try {
        const page = await wereadSimilarBooks(forBook, from.nextIdx, from.sessionId);
        if (owner.current !== forBook) return;
        setBooks((prev) => {
          const base = reset ? [] : prev;
          const seen = new Set(base.map((b) => b.bookId));
          return [...base, ...page.books.filter((b) => !seen.has(b.bookId))];
        });
        setCursor({ nextIdx: page.nextIdx, sessionId: page.sessionId, hasMore: page.hasMore });
      } catch (err) {
        if (owner.current === forBook) setError(String(err ?? "加载失败"));
      } finally {
        if (owner.current === forBook) setLoading(false);
      }
    },
    [bookId],
  );

  useEffect(() => {
    owner.current = bookId;
    setBooks([]);
    setCursor(FIRST_PAGE);
    loadPage(FIRST_PAGE, true);
  }, [bookId, loadPage]);

  if (error && books.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "32px", fontSize: "13px" }}>
        <p style={{ color: "#ef4444", userSelect: "text", wordBreak: "break-all" }}>
          相似书加载失败：{error}
        </p>
        <button className="btn btn-secondary btn-sm" onClick={() => loadPage(FIRST_PAGE, true)}>
          <RefreshCw size={12} /> 重试
        </button>
      </div>
    );
  }

  if (loading && books.length === 0) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
        <Loader2 className="spin" size={24} style={{ color: "var(--text-secondary)" }} />
      </div>
    );
  }

  if (books.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
        暂无相似书
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
          gap: "14px",
        }}
      >
        {books.map((b) => (
          <WereadBookCard
            key={b.bookId}
            title={b.title}
            cover={b.cover}
            subtitle={b.author}
            onClick={() => onOpenBook(b.bookId)}
          />
        ))}
      </div>
      {error && (
        <p
          style={{
            color: "#ef4444",
            fontSize: "12px",
            textAlign: "center",
            marginTop: "12px",
            userSelect: "text",
          }}
        >
          加载更多失败：{error}
        </p>
      )}
      {cursor.hasMore && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: "16px" }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={loading}
            onClick={() => loadPage(cursor, false)}
          >
            {loading ? <Loader2 size={12} className="spin" /> : null}
            {error ? "重试" : "加载更多"}
          </button>
        </div>
      )}
    </div>
  );
}
