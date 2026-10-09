import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Sparkles, Loader2, LayoutGrid, BookMarked } from "lucide-react";
import toast from "react-hot-toast";
import { getPopularBooks, getBookInfo } from "../../api/books";
import { downloadBook } from "../../api/download";
import { addFavorite } from "../../api/favorites";
import DownloadLimitDialog, { isDownloadLimitError } from "../../components/DownloadLimitDialog";
import { describeDownloadError } from "../../utils/downloadError";
import BookDetailModal from "../../components/BookDetailModal";
import { useCoverCache } from "../../hooks/useCoverCache";
import type { Book } from "./types";
import { READING_QUOTES } from "./constants";
import BookShelf3D from "./BookShelf3D";
import DiscoverGridView from "./DiscoverGridView";

// 后端线路异常标记（对应 zlibrary.rs 的 ERR_CF_BLOCKED / ERR_LINE_UNAVAILABLE）。
// 区分三种情况：正常返回数据 / Cloudflare 拦截 / 域名不可用，避免笼统报「解析失败」。
const classifyLoadError = (raw: string): { message: string; lineIssue: boolean } => {
  const s = raw.replace(/^Error:\s*/, "");
  const m = s.match(/(CF_BLOCKED|LINE_UNAVAILABLE):\s*([\s\S]*)$/);
  if (m) return { message: m[2].trim(), lineIssue: true };
  return { message: s, lineIssue: false };
};

const DiscoverPage: React.FC = () => {
  const [books, setBooks] = useState<Book[]>([]);
  const [currentIndex, setCurrentIndex] = useState(() => {
    try {
      const saved = localStorage.getItem("olib-discover-current-index");
      return saved ? Math.max(0, parseInt(saved, 10) || 0) : 0;
    } catch {
      return 0;
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorIsLine, setErrorIsLine] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [limitError, setLimitError] = useState<string | null>(null);
  // Book.id 类型跨页分裂（P3 统一，见 dev_docs/engineering-optimization.md），统一前用 any 桥接
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedBook, setSelectedBook] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [viewMode, setViewMode] = useState<"shelf" | "grid">("shelf");

  const { getCoverUrl, handleCoverError } = useCoverCache();

  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const booksRef = useRef(books);
  booksRef.current = books;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  // Restore saved view mode
  useEffect(() => {
    try {
      const savedMode = localStorage.getItem("olib-discover-view-mode");
      if (savedMode === "grid" || savedMode === "shelf") setViewMode(savedMode);
      // Migrate old 'tinder' preference
      if (savedMode === "tinder") {
        setViewMode("shelf");
        localStorage.setItem("olib-discover-view-mode", "shelf");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const handleViewModeChange = (mode: "shelf" | "grid") => {
    setViewMode(mode);
    try {
      localStorage.setItem("olib-discover-view-mode", mode);
    } catch {
      /* ignore */
    }
  };

  const quote = useMemo(
    () => READING_QUOTES[Math.floor(Math.random() * READING_QUOTES.length)],
    [],
  );

  useEffect(() => {
    loadBooks();
  }, []);

  // Keyboard handler (simplified: ← → browse, Enter detail, F favorite)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (selectedBook) return;
      if (viewModeRef.current !== "shelf") return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleNavigate("left");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNavigate("right");
      } else if (e.key === "Enter") {
        e.preventDefault();
        const book = booksRef.current[currentIndexRef.current];
        if (book) handleCardClick(book);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        const book = booksRef.current[currentIndexRef.current];
        if (book) addToFavorites(book);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedBook]);

  const handleNavigate = useCallback(
    (direction: "left" | "right") => {
      setCurrentIndex((prev) => {
        const next = direction === "right" ? prev + 1 : prev - 1;
        if (next < 0) return 0;
        if (next >= booksRef.current.length) return prev;
        // Auto-load more books when near end
        if (next >= booksRef.current.length - 5 && !loading) loadBooks();
        try {
          localStorage.setItem("olib-discover-current-index", String(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [loading],
  );

  const loadBooks = async () => {
    setLoading((prev) => (books.length === 0 ? true : prev));
    setError("");
    setErrorIsLine(false);
    try {
      const result = await getPopularBooks("en");
      // 热门接口的书目 id 实际为 string（api 层为兼容搜索接口标为 number | string）
      const newBooks = (result.books || []) as Book[];
      if (newBooks.length > 0) {
        setBooks((prev) => {
          const merged = prev.length > 0 ? [...prev, ...newBooks] : newBooks;
          // Clamp saved index to valid range after first load
          if (prev.length === 0) {
            setCurrentIndex((ci) => Math.min(ci, merged.length - 1));
          }
          return merged;
        });
      } else if (books.length === 0) {
        setError("暂无书籍");
      }
    } catch (err) {
      console.error("Failed to load books:", err);
      // 区分 Cloudflare 拦截 / 域名不可用，给出可操作的提示而非笼统的解析失败
      if (books.length === 0) {
        const { message, lineIssue } = classifyLoadError(String(err ?? "") || "加载失败");
        setError(message);
        setErrorIsLine(lineIssue);
      }
    } finally {
      setLoading(false);
    }
  };

  // Fire-and-forget favorites
  const addToFavorites = (book: Book) => {
    addFavorite({
      book_id: String(book.id),
      hash: book.hash || "",
      title: book.title || "Unknown",
      author: book.author || "",
      publisher: book.publisher || "",
      year: book.year || null,
      language: book.language || "",
      extension: book.extension || "",
      filesize: book.filesize || null,
      cover: book.cover || "",
      description: book.description || "",
      pages: book.pages || null,
    })
      .then(() => toast.success(`已加入收藏: ${book.title}`, { icon: "💖" }))
      .catch((err) => {
        const errStr = String(err);
        if (errStr.includes("请先登录") || errStr.includes("login")) {
          toast.error("收藏失败：请先在「设置」中登录账号", { icon: "🔒" });
        } else {
          toast.error(`收藏失败: ${err}`);
        }
      });
  };

  const handleDownload = async (book: Book) => {
    if (downloadingIds.has(String(book.id))) return;
    setDownloadingIds((prev) => new Set(prev).add(String(book.id)));
    try {
      const result = await downloadBook({
        bookId: String(book.id),
        hashId: book.hash || "",
        title: book.title || "Unknown",
        extension: book.extension || "pdf",
        author: book.author,
        cover: book.cover,
      });
      if (result.startsWith("dispatched:")) {
        const method = result.split(":")[1];
        const labels: Record<string, string> = {
          browser: "已发送到浏览器",
          idm: "已发送到 IDM",
          motrix: "已发送到 Motrix",
          copy_url: "链接已复制到剪贴板",
        };
        toast.success(labels[method] || "已转交外部工具", { icon: "🔗" });
      } else {
        toast.success(`下载成功: ${book.title}`);
      }
    } catch (err) {
      const errStr = String(err);
      if (isDownloadLimitError(errStr)) setLimitError(errStr);
      else {
        const text = describeDownloadError(err);
        if (text) toast.error(text, { duration: 6000 });
      }
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(String(book.id));
        return next;
      });
    }
  };

  const handleCardClick = async (book: Book) => {
    setLoadingDetail(true);
    try {
      const result = await getBookInfo(String(book.id), book.hash || "");
      const detail = result.book || result;
      setSelectedBook({
        ...detail,
        id: Number(book.id) || book.id,
        title: detail.title || book.title,
        author: detail.author || book.author,
        year: detail.year ? Number(detail.year) : book.year,
        language: detail.language || book.language,
        extension: detail.extension || book.extension,
        filesize: detail.filesize ? Number(detail.filesize) : book.filesize,
        filesizeString: detail.filesizeString || book.filesizeString,
        hash: detail.hash || book.hash,
        cover: detail.cover || book.cover,
      });
    } catch (err) {
      console.warn("Failed to fetch book detail, using basic info:", err);
      setSelectedBook({
        ...book,
        id: Number(book.id) || book.id,
      });
    }
    setLoadingDetail(false);
  };

  return (
    <>
      {/* Immersive Blurred Cover Background */}
      {books[currentIndex] && (
        <div
          style={{
            position: "fixed",
            inset: "-20px",
            background: `url(${getCoverUrl(String(books[currentIndex].id), books[currentIndex].cover)}) center/cover no-repeat`,
            filter: "blur(80px)",
            opacity: 0.25,
            pointerEvents: "none",
            zIndex: 0,
            transition: "background-image 0.6s ease-in-out",
          }}
        />
      )}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--bg-primary)",
          opacity: 0.85,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: "fixed",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% -20%, var(--accent-glow) 0%, transparent 60%)",
          opacity: 0.1,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <div
        className="page-container"
        style={{ position: "relative", zIndex: 1, padding: "16px 20px" }}
      >
        {/* Minimal Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "32px",
            marginTop: "16px",
          }}
        >
          <div style={{ flex: 1 }}></div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <h1
              style={{
                fontSize: "20px",
                fontWeight: 800,
                color: "var(--text-primary)",
                margin: "0 0 8px 0",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                opacity: 0.9,
              }}
            >
              <Sparkles size={18} style={{ color: "var(--accent)" }} /> 每日发现
            </h1>
            <p
              style={{
                fontSize: "12px",
                color: "#888",
                margin: 0,
                letterSpacing: "1px",
                fontWeight: 500,
                opacity: 0.7,
                fontStyle: "italic",
                textAlign: "center",
              }}
            >
              「{quote.text}」— {quote.author}
            </p>
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "8px",
                background: "rgba(255,255,255,0.05)",
                padding: "4px",
                borderRadius: "8px",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <button
                onClick={() => handleViewModeChange("shelf")}
                title="书架模式"
                style={{
                  background: viewMode === "shelf" ? "var(--bg-secondary)" : "transparent",
                  color: viewMode === "shelf" ? "var(--text-primary)" : "var(--text-tertiary)",
                  border: "none",
                  padding: "6px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  boxShadow: viewMode === "shelf" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                  transition: "all 0.2s",
                }}
              >
                <BookMarked size={16} />
              </button>
              <button
                onClick={() => handleViewModeChange("grid")}
                title="列表模式"
                style={{
                  background: viewMode === "grid" ? "var(--bg-secondary)" : "transparent",
                  color: viewMode === "grid" ? "var(--text-primary)" : "var(--text-tertiary)",
                  border: "none",
                  padding: "6px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  boxShadow: viewMode === "grid" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                  transition: "all 0.2s",
                }}
              >
                <LayoutGrid size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="empty-state">
            <Loader2 size={40} className="spinner empty-state-icon" />
            <p className="empty-state-text">正在加载书籍...</p>
            <p className="empty-state-hint">请稍候</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            className="card"
            style={{
              padding: "16px 20px",
              marginBottom: "20px",
              borderColor: "rgba(239, 68, 68, 0.3)",
              background: "rgba(239, 68, 68, 0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "var(--error)",
                  flexShrink: 0,
                }}
              />
              <span style={{ color: "var(--error)", fontSize: "13px" }}>{error}</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: "6px", flexShrink: 0 }}>
                {errorIsLine && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("olib:navigate", { detail: "/settings" }),
                      )
                    }
                  >
                    去切换线路
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => loadBooks()}>
                  重试
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && books.length === 0 && (
          <div className="empty-state">
            <Sparkles size={40} className="empty-state-icon" />
            <p className="empty-state-text">暂无更多推荐</p>
            <p className="empty-state-hint">去搜索页面看看吧</p>
          </div>
        )}

        {/* 3D Bookshelf View */}
        {!error && books.length > 0 && viewMode === "shelf" && (
          <BookShelf3D
            books={books}
            currentIndex={currentIndex}
            getCoverUrl={getCoverUrl}
            handleCoverError={handleCoverError}
            onCardClick={handleCardClick}
            onFavorite={addToFavorites}
            onNavigate={handleNavigate}
          />
        )}

        {/* Grid View */}
        {!error && books.length > 0 && viewMode === "grid" && (
          <DiscoverGridView
            books={books}
            getCoverUrl={getCoverUrl}
            handleCoverError={handleCoverError}
            onCardClick={handleCardClick}
          />
        )}
      </div>

      {/* Book Detail Modal */}
      {selectedBook && (
        <BookDetailModal
          book={selectedBook}
          coverUrl={getCoverUrl(String(selectedBook.id), selectedBook.cover) || selectedBook.cover}
          isDownloading={downloadingIds.has(String(selectedBook.id))}
          onDownload={(_, book) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            handleDownload(book as any)
          }
          onClose={() => setSelectedBook(null)}
        />
      )}

      {/* Loading Detail Overlay */}
      {loadingDetail && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "16px 24px",
              background: "var(--bg-secondary)",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <Loader2 size={20} className="spinner" />
            <span style={{ fontSize: "14px", color: "var(--text-primary)" }}>加载书籍详情...</span>
          </div>
        </div>
      )}

      {/* Download Limit Dialog */}
      {limitError && (
        <DownloadLimitDialog
          message={limitError!}
          onSwitchAccount={() => {
            window.dispatchEvent(new CustomEvent("olib:show-login"));
          }}
          onClose={() => setLimitError(null)}
        />
      )}
    </>
  );
};

export default DiscoverPage;
