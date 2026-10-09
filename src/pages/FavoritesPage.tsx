import { useState, useEffect } from "react";
import { getFavorites, removeFavorite } from "../api/favorites";
import { downloadBook } from "../api/download";
import { useCoverCache } from "../hooks/useCoverCache";
import {
  Heart,
  Download,
  Loader2,
  BookOpen,
  Trash2,
  Search,
  QrCode,
  ClipboardPaste,
} from "lucide-react";
import toast from "react-hot-toast";
import BookDetailModal from "../components/BookDetailModal";
import DownloadLimitDialog, { isDownloadLimitError } from "../components/DownloadLimitDialog";
import { describeDownloadError } from "../utils/downloadError";
import BooklistShareModal from "../components/BooklistShareModal";
import BooklistImportModal from "../components/BooklistImportModal";

interface FavoriteBook {
  book_id: string;
  user_email: string;
  hash?: string;
  title: string;
  author?: string;
  publisher?: string;
  year?: number;
  language?: string;
  extension?: string;
  filesize?: number;
  cover?: string;
  description?: string;
  pages?: number;
  added_at?: string;
}

function formatSize(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoriteBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  // Book.id 类型跨页分裂（P3 统一，见 dev_docs/engineering-optimization.md），统一前用 any 桥接
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedBook, setSelectedBook] = useState<any>(null);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showShare, setShowShare] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { getCoverUrl: getCoverUrlRaw, handleCoverError } = useCoverCache();

  useEffect(() => {
    loadFavorites();
  }, []);

  const getCoverUrl = (book: FavoriteBook): string | undefined => {
    return getCoverUrlRaw(book.book_id, book.cover);
  };

  const loadFavorites = async () => {
    setLoading(true);
    try {
      // api 层 FavoriteBook 的空字段为 null，本页历史类型按可选字段（undefined）建模；
      // 运行时两者均按 falsy 处理，行为一致，此处仅做类型对齐断言。
      const result = (await getFavorites(1, 200)) as unknown as FavoriteBook[];
      setFavorites(result);
    } catch (err) {
      console.error("Failed to load favorites:", err);
    }
    setLoading(false);
  };

  const handleRemove = async (bookId: string) => {
    setRemovingIds((prev) => new Set(prev).add(bookId));
    try {
      await removeFavorite(bookId);
      setFavorites((prev) => prev.filter((f) => f.book_id !== bookId));
      toast.success("已取消收藏");
    } catch (err) {
      console.error("Failed to remove favorite:", err);
      toast.error("取消收藏失败");
    }
    setRemovingIds((prev) => {
      const n = new Set(prev);
      n.delete(bookId);
      return n;
    });
  };

  const handleDownload = async (book: FavoriteBook) => {
    if (downloadingIds.has(book.book_id)) return;
    setDownloadingIds((prev) => new Set(prev).add(book.book_id));
    try {
      const result = await downloadBook({
        bookId: book.book_id,
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
      if (isDownloadLimitError(errStr)) {
        setLimitError(errStr);
      } else {
        const text = describeDownloadError(err);
        if (text) toast.error(text, { duration: 6000 });
      }
    } finally {
      setDownloadingIds((prev) => {
        const n = new Set(prev);
        n.delete(book.book_id);
        return n;
      });
    }
  };

  // Convert FavoriteBook to Book-like object for BookDetailModal
  const toBookObj = (fav: FavoriteBook) => ({
    id: Number(fav.book_id),
    title: fav.title,
    author: fav.author || "",
    publisher: fav.publisher,
    year: fav.year,
    language: fav.language,
    extension: fav.extension,
    filesize: fav.filesize,
    hash: fav.hash,
    cover: fav.cover,
    description: fav.description,
    pages: fav.pages,
  });

  // Filter favorites by search
  const filtered = searchQuery.trim()
    ? favorites.filter(
        (f) =>
          f.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (f.author && f.author.toLowerCase().includes(searchQuery.toLowerCase())),
      )
    : favorites;

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">收藏</h1>
          <p className="page-subtitle">
            {favorites.length > 0 ? `共收藏 ${favorites.length} 本书籍` : "收藏你感兴趣的书籍"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowImport(true)}
            title="粘贴手机端分享的书单口令"
          >
            <ClipboardPaste size={14} /> 导入书单
          </button>
          {favorites.length > 0 && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowShare(true)}
              title="导出二维码/口令，手机端扫码导入"
            >
              <QrCode size={14} /> 分享书单
            </button>
          )}
        </div>
      </div>

      {/* Search filter */}
      {favorites.length > 0 && (
        <div
          style={{
            marginBottom: "16px",
            position: "relative",
          }}
        >
          <Search
            size={16}
            style={{
              position: "absolute",
              left: "12px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
            }}
          />
          <input
            className="search-input"
            placeholder="在收藏中搜索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              paddingLeft: "36px",
              height: "38px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-surface)",
              fontSize: "13px",
            }}
          />
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="empty-state">
          <Loader2 size={40} className="spinner empty-state-icon" />
          <p className="empty-state-text">加载中...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: "80px 20px" }}>
          <div
            style={{
              fontSize: "48px",
              marginBottom: "16px",
              animation: "fadeIn var(--transition-slow)",
            }}
          >
            {searchQuery.trim() ? "🔍" : "📚"}
          </div>
          <p className="empty-state-text" style={{ fontSize: "16px", marginBottom: "8px" }}>
            {searchQuery.trim() ? "没有找到匹配的收藏" : "你的书架还空空如也"}
          </p>
          <p className="empty-state-hint" style={{ maxWidth: "300px", lineHeight: 1.6 }}>
            {searchQuery.trim()
              ? "换个关键词试试吧"
              : "每一本好书都值得被收藏 💛 去搜索或发现页面，点击 ♥ 开始你的阅读清单吧"}
          </p>
        </div>
      ) : (
        /* Favorites Grid */
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: "14px",
          }}
        >
          {filtered.map((fav) => {
            const isDownloading = downloadingIds.has(fav.book_id);
            const isRemoving = removingIds.has(fav.book_id);
            const coverUrl = getCoverUrl(fav);
            return (
              <div
                key={fav.book_id}
                className="card favorite-card"
                style={{
                  padding: 0,
                  overflow: "hidden",
                  cursor: "pointer",
                  transition: "all var(--transition-normal)",
                  position: "relative",
                }}
                onClick={() => setSelectedBook(fav)}
              >
                {/* Cover */}
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: "3/3.6",
                    background: "var(--bg-tertiary)",
                    overflow: "hidden",
                  }}
                >
                  {coverUrl ? (
                    <img
                      src={coverUrl}
                      alt={fav.title}
                      loading="lazy"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        transition: "transform var(--transition-slow)",
                      }}
                      onError={() => handleCoverError(fav.book_id)}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background:
                          "linear-gradient(135deg, var(--bg-tertiary), var(--bg-secondary))",
                      }}
                    >
                      <BookOpen size={44} style={{ opacity: 0.15 }} />
                    </div>
                  )}

                  {/* Action buttons overlay */}
                  <div
                    className="favorite-card-overlay"
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "linear-gradient(to top, rgba(0,0,0,0.78) 0%, transparent 55%)",
                      opacity: 0,
                      transition: "opacity var(--transition-normal)",
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                      padding: "12px",
                      gap: "8px",
                    }}
                  >
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ flex: 1, backdropFilter: "blur(8px)" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(fav);
                      }}
                      disabled={isDownloading}
                    >
                      {isDownloading ? (
                        <>
                          <Loader2 size={14} className="spinner" /> 下载中...
                        </>
                      ) : (
                        <>
                          <Download size={14} /> 下载
                        </>
                      )}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      style={{
                        backdropFilter: "blur(8px)",
                        color: "#ef4444",
                        borderColor: "rgba(239,68,68,0.3)",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(fav.book_id);
                      }}
                      disabled={isRemoving}
                      title="取消收藏"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Format badge */}
                  {fav.extension && (
                    <span
                      className="badge badge-accent"
                      style={{
                        position: "absolute",
                        top: "8px",
                        right: "8px",
                        fontSize: "10px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        backdropFilter: "blur(8px)",
                      }}
                    >
                      {fav.extension}
                    </span>
                  )}

                  {/* Favorite heart badge */}
                  <div
                    style={{
                      position: "absolute",
                      top: "8px",
                      left: "8px",
                    }}
                  >
                    <Heart size={16} fill="#ef4444" color="#ef4444" />
                  </div>
                </div>

                {/* Info */}
                <div style={{ padding: "8px 10px" }}>
                  <div
                    className="truncate"
                    title={fav.title}
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      marginBottom: "2px",
                      letterSpacing: "-0.2px",
                    }}
                  >
                    {fav.title}
                  </div>
                  <div
                    className="truncate text-muted"
                    title={fav.author}
                    style={{
                      fontSize: "10px",
                      marginBottom: "4px",
                    }}
                  >
                    {fav.author || "—"}
                  </div>
                  <div
                    style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}
                  >
                    <span className="text-muted" style={{ fontSize: "10px" }}>
                      {formatSize(fav.filesize || 0)}
                    </span>
                    {fav.year && (
                      <>
                        <span className="text-muted" style={{ fontSize: "10px" }}>
                          ·
                        </span>
                        <span className="text-muted" style={{ fontSize: "10px" }}>
                          {fav.year}
                        </span>
                      </>
                    )}
                    {fav.added_at && (
                      <>
                        <span className="text-muted" style={{ fontSize: "10px" }}>
                          ·
                        </span>
                        <span className="text-muted" style={{ fontSize: "10px" }}>
                          {formatDate(fav.added_at)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Book Detail Modal */}
      {selectedBook && (
        <BookDetailModal
          book={toBookObj(selectedBook)}
          coverUrl={getCoverUrl(selectedBook)}
          isDownloading={downloadingIds.has(selectedBook.book_id)}
          onDownload={(_, book) =>
            handleDownload({
              ...selectedBook,
              book_id: String(book.id),
              hash: book.hash,
              extension: book.extension,
            })
          }
          onClose={() => setSelectedBook(null)}
        />
      )}

      {/* Download Limit Dialog */}
      {limitError && (
        <DownloadLimitDialog
          message={limitError}
          onSwitchAccount={() => window.dispatchEvent(new Event("olib:show-login"))}
          onClose={() => setLimitError(null)}
        />
      )}

      {/* Booklist Share Modal */}
      {showShare && (
        <BooklistShareModal
          data={{
            entries: favorites.map((f) => ({
              id: f.book_id,
              title: f.title,
              author: f.author,
              hash: f.hash,
            })),
            exportedAt: new Date().toISOString(),
          }}
          onClose={() => setShowShare(false)}
        />
      )}

      {/* Booklist Import Modal */}
      {showImport && (
        <BooklistImportModal onImported={loadFavorites} onClose={() => setShowImport(false)} />
      )}
    </div>
  );
}
