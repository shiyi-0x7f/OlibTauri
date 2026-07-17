import React from "react";
import { BookOpen, Download, Loader2, Heart } from "lucide-react";
import type { Book } from "./types";
import { formatSize } from "./utils";

interface SearchListViewProps {
    books: Book[];
    downloadingIds: Set<number>;
    favoriteIds: Set<string>;
    getCoverUrl: (bookId: string, fallback?: string) => string | undefined;
    handleCoverError: (bookId: string) => void;
    onBookClick: (book: Book) => void;
    onDownload: (e: React.MouseEvent, book: Book) => void;
    onToggleFavorite: (book: Book) => void;
}

export default function SearchListView({
    books, downloadingIds, favoriteIds,
    getCoverUrl, handleCoverError, onBookClick, onDownload, onToggleFavorite,
}: SearchListViewProps) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
            {books.map((book, i) => {
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
                            transition: "all var(--transition-fast)",
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = "var(--accent)";
                            e.currentTarget.style.boxShadow = "var(--shadow-sm)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = "var(--border)";
                            e.currentTarget.style.boxShadow = "none";
                        }}
                    >
                        <div style={{ display: "flex" }}>
                            {/* Mini Cover */}
                            <div style={{
                                position: "relative",
                                width: "64px",
                                minHeight: "88px",
                                flexShrink: 0,
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
                                        loading="lazy"
                                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                        onError={() => handleCoverError(String(book.id))}
                                    />
                                ) : (
                                    <BookOpen size={22} style={{ opacity: 0.2 }} />
                                )}
                            </div>

                            {/* Info */}
                            <div style={{
                                flex: 1, minWidth: 0, padding: "12px 16px",
                                display: "flex", flexDirection: "column", justifyContent: "center",
                            }}>
                                <div className="truncate" title={book.title} style={{
                                    fontSize: "14px", fontWeight: 600,
                                    color: "var(--text-primary)", marginBottom: "3px",
                                }}>
                                    {book.title || "未知"}
                                </div>
                                <div className="truncate text-muted" style={{
                                    fontSize: "12px", marginBottom: "6px",
                                }}>
                                    {book.author || "—"}
                                </div>
                                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                    {book.extension && (
                                        <span className="badge badge-accent" style={{ fontSize: "10px", textTransform: "uppercase" }}>
                                            {book.extension}
                                        </span>
                                    )}
                                    <span className="text-muted" style={{ fontSize: "11px" }}>
                                        {book.filesizeString || formatSize(book.filesize || 0)}
                                    </span>
                                    {book.year && (
                                        <span className="text-muted" style={{ fontSize: "11px" }}>{book.year}</span>
                                    )}
                                    {book.language && (
                                        <span className="text-muted" style={{ fontSize: "11px", textTransform: "uppercase" }}>
                                            {book.language}
                                        </span>
                                    )}
                                    {book.pages && (
                                        <span className="text-muted" style={{ fontSize: "11px" }}>
                                            {book.pages} 页
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div style={{
                                display: "flex", alignItems: "center",
                                padding: "0 16px", flexShrink: 0,
                                gap: "6px",
                            }}>
                                <button
                                    className="btn btn-ghost btn-sm btn-icon favorite-btn"
                                    onClick={(e) => { e.stopPropagation(); onToggleFavorite(book); }}
                                    title={favoriteIds.has(String(book.id)) ? "取消收藏" : "收藏"}
                                    style={{
                                        color: favoriteIds.has(String(book.id)) ? "#ef4444" : "var(--text-muted)",
                                    }}
                                >
                                    <Heart size={16} fill={favoriteIds.has(String(book.id)) ? "#ef4444" : "none"} />
                                </button>
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={(e) => onDownload(e, book)}
                                    disabled={isDownloading}
                                >
                                    {isDownloading ? (
                                        <Loader2 size={14} className="spinner" />
                                    ) : (
                                        <Download size={14} />
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
