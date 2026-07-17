import { BookOpen } from "lucide-react";
import type { Book } from "./types";
import { formatFileSize } from "./utils";

interface DiscoverGridViewProps {
  books: Book[];
  getCoverUrl: (bookId: string, fallback?: string) => string | undefined;
  handleCoverError: (bookId: string) => void;
  onCardClick: (book: Book) => void;
}

export default function DiscoverGridView({
  books, getCoverUrl, handleCoverError, onCardClick,
}: DiscoverGridViewProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
      gap: "20px",
      paddingTop: "16px",
      paddingBottom: "40px"
    }}>
      {books.map((book, i) => {
        const coverUrl = getCoverUrl(String(book.id), book.cover);
        return (
          <div
            onClick={() => onCardClick(book)}
            key={book.id || i}
            className="card"
            style={{
              padding: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              transition: "all var(--transition-bounce)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-4px)";
              e.currentTarget.style.boxShadow = "var(--shadow-lg)";
              e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "var(--shadow-sm)";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          >
            {/* Cover Area */}
            <div style={{
              position: "relative",
              aspectRatio: "3/4",
              width: "100%",
              background: "var(--bg-tertiary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}>
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={book.title}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={() => handleCoverError(String(book.id))}
                  loading="lazy"
                />
              ) : (
                <BookOpen size={48} style={{ opacity: 0.1 }} />
              )}

              {/* Format badge */}
              {book.extension && (
                <span className="badge badge-accent" style={{
                  position: "absolute",
                  top: "8px",
                  right: "8px",
                  fontSize: "10px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  backdropFilter: "blur(8px)",
                }}>
                  {book.extension}
                </span>
              )}
              
              {/* Hover Overlay */}
              <div className="card-hover-overlay" style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0,
                transition: "opacity var(--transition-fast)",
                backdropFilter: "blur(2px)",
              }}>
                <div style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  background: "var(--accent)",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: "scale(0.8)",
                  transition: "transform var(--transition-bounce)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)"
                }}>
                  <BookOpen size={20} />
                </div>
              </div>
            </div>

            {/* Info */}
            <div style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column" }}>
              <div className="truncate" title={book.title} style={{
                fontSize: "13px", fontWeight: 600,
                color: "var(--text-primary)", marginBottom: "3px",
                letterSpacing: "-0.2px",
              }}>
                {book.title || "未知"}
              </div>
              <div className="truncate text-muted" title={book.author} style={{
                fontSize: "11px", marginBottom: "6px",
              }}>
                {book.author || "—"}
              </div>
              <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", marginTop: "auto" }}>
                <span className="text-muted" style={{ fontSize: "10px" }}>
                  {book.filesizeString || formatFileSize(book.filesize)}
                </span>
                {book.language && (
                  <>
                    <span className="text-muted" style={{ fontSize: "10px" }}>·</span>
                    <span className="text-muted" style={{ fontSize: "10px", textTransform: "uppercase" }}>
                      {book.language}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
