import React from "react";
import { BookOpen, Download, Loader2, Heart, CheckCircle2 } from "lucide-react";
import type { Book } from "./types";
import { formatSize } from "./utils";

interface SearchGridViewProps {
    books: Book[];
    hoveredId: number | null;
    setHoveredId: (id: number | null) => void;
    downloadingIds: Set<number>;
    favoriteIds: Set<string>;
    downloadedIds: Set<string>;
    getCoverUrl: (bookId: string, fallback?: string) => string | undefined;
    handleCoverError: (bookId: string) => void;
    onBookClick: (book: Book) => void;
    onDownload: (e: React.MouseEvent, book: Book) => void;
    onToggleFavorite: (book: Book) => void;
}

export default function SearchGridView({
    books, hoveredId, setHoveredId, downloadingIds, favoriteIds, downloadedIds,
    getCoverUrl, handleCoverError, onBookClick, onDownload, onToggleFavorite,
}: SearchGridViewProps) {
    return (
        <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: "14px",
            marginBottom: "24px",
        }}>
            {books.map((book, i) => {
                const isHovered = hoveredId === i;
                const isDownloading = downloadingIds.has(book.id);
                const coverUrl = getCoverUrl(String(book.id), book.cover);
                return (
                    <div
                        onClick={() => onBookClick(book)}
                        key={i}
                        className="card"
                        style={{
                            padding: 0,
                            overflow: "hidden",
                            cursor: "pointer",
                            transition: "all var(--transition-normal)",
                            transform: isHovered ? "translateY(-6px)" : "none",
                            boxShadow: isHovered ? "var(--shadow-lg), 0 0 24px var(--accent-glow)" : "none",
                            borderColor: isHovered ? "var(--accent)" : "var(--border)",
                        }}
                        onMouseEnter={() => setHoveredId(i)}
                        onMouseLeave={() => setHoveredId(null)}
                    >
                        {/* Cover */}
                        <div style={{
                            position: "relative",
                            width: "100%",
                            aspectRatio: "3/3.6",
                            background: "var(--bg-tertiary)",
                            overflow: "hidden",
                        }}>
                            {coverUrl ? (
                                <img
                                    src={coverUrl}
                                    alt={book.title}
                                    loading="lazy"
                                    style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        transition: "transform var(--transition-slow)",
                                        transform: isHovered ? "scale(1.06)" : "scale(1)",
                                    }}
                                    onError={() => handleCoverError(String(book.id))}
                                />
                            ) : (
                                <div style={{
                                    width: "100%", height: "100%",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    background: "linear-gradient(135deg, var(--bg-tertiary), var(--bg-secondary))",
                                }}>
                                    <BookOpen size={44} style={{ opacity: 0.15 }} />
                                </div>
                            )}

                            {/* Hover overlay with download */}
                            <div style={{
                                position: "absolute",
                                inset: 0,
                                background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%)",
                                opacity: isHovered ? 1 : 0,
                                transition: "opacity var(--transition-normal)",
                                display: "flex",
                                alignItems: "flex-end",
                                justifyContent: "center",
                                padding: "14px",
                                gap: "8px",
                            }}>
                                <button
                                    className="btn btn-primary btn-sm"
                                    style={{ flex: 1, backdropFilter: "blur(8px)" }}
                                    onClick={(e) => onDownload(e, book)}
                                    disabled={isDownloading}
                                >
                                    {isDownloading ? (
                                        <><Loader2 size={14} className="spinner" /> 下载中...</>
                                    ) : (
                                        <><Download size={14} /> 下载</>
                                    )}
                                </button>
                                <button
                                    className="btn btn-ghost btn-sm btn-icon favorite-btn"
                                    style={{
                                        backdropFilter: "blur(8px)",
                                        color: favoriteIds.has(String(book.id)) ? "#ef4444" : "white",
                                    }}
                                    onClick={(e) => { e.stopPropagation(); onToggleFavorite(book); }}
                                    title={favoriteIds.has(String(book.id)) ? "取消收藏" : "收藏"}
                                >
                                    <Heart size={14} fill={favoriteIds.has(String(book.id)) ? "#ef4444" : "none"} />
                                </button>
                            </div>

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

                            {/* Downloaded Indicator Badge */}
                            {downloadedIds.has(String(book.id)) && (
                                <span className="badge badge-success" style={{
                                    position: "absolute",
                                    top: "8px",
                                    left: "8px",
                                    fontSize: "10px",
                                    fontWeight: 600,
                                    backdropFilter: "blur(8px)",
                                    background: "rgba(34, 197, 94, 0.9)",
                                    color: "white",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "2px"
                                }}>
                                    <CheckCircle2 size={12} />
                                    已下载
                                </span>
                            )}
                        </div>

                        {/* Info */}
                        <div style={{ padding: "12px 14px" }}>
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
                            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                                <span className="text-muted" style={{ fontSize: "10px" }}>
                                    {book.filesizeString || formatSize(book.filesize || 0)}
                                </span>
                                {book.year && (
                                    <>
                                        <span className="text-muted" style={{ fontSize: "10px" }}>·</span>
                                        <span className="text-muted" style={{ fontSize: "10px" }}>{book.year}</span>
                                    </>
                                )}
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
