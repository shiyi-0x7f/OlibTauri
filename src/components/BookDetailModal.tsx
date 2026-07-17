import React from "react";
import { invoke } from "@tauri-apps/api/core";
import {
    X, Download, BookOpen, Loader2, Eye,
    Calendar, FileText, Globe, Hash, Layers,
} from "lucide-react";
import ReaderModal from "./ReaderModal";

interface Book {
    id: number;
    title: string;
    author: string;
    publisher?: string;
    year?: number;
    language?: string;
    extension?: string;
    filesize?: number;
    filesizeString?: string;
    hash?: string;
    cover?: string;
    description?: string;
    pages?: number;
    [key: string]: any;
}

interface BookDetailModalProps {
    book: Book;
    coverUrl?: string;
    isDownloading: boolean;
    onDownload: (e: React.MouseEvent, book: Book) => void | Promise<void>;
    onClose: () => void;
}

/** /formats 返回的同书其他格式版本（独立书目，各自 id/hash） */
interface FormatEntry {
    id: number;
    hash: string;
    extension: string;
    filesize?: number;
    filesizeString?: string;
}

function formatSize(bytes: number): string {
    if (!bytes) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(1)} ${units[i]}`;
}

const BookDetailModal: React.FC<BookDetailModalProps> = ({
    book, coverUrl: externalCoverUrl, isDownloading, onDownload, onClose,
}) => {
    const [coverFailed, setCoverFailed] = React.useState(false);
    const [readerUrl, setReaderUrl] = React.useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = React.useState(false);
    const [formats, setFormats] = React.useState<FormatEntry[] | null>(null);
    const [formatsError, setFormatsError] = React.useState<string | null>(null);
    const [downloadingFormatId, setDownloadingFormatId] = React.useState<number | null>(null);

    // 拉取同书其他格式版本
    React.useEffect(() => {
        let cancelled = false;
        setFormats(null);
        setFormatsError(null);
        if (!book.hash) { setFormats([]); return; }
        invoke<{ success: number; books?: FormatEntry[] }>("get_book_formats", {
            bookId: String(book.id), hashId: book.hash,
        }).then((resp) => {
            if (cancelled) return;
            const list = (resp?.books || []).filter((f) => f.id !== book.id && f.hash);
            setFormats(list);
        }).catch((err) => {
            if (cancelled) return;
            console.error("Failed to get book formats:", err);
            setFormatsError(String(err));
            setFormats([]);
        });
        return () => { cancelled = true; };
    }, [book.id, book.hash]);

    // 下载指定格式版本：复用父级下载流程（该版本是独立书目，带自己的 id/hash）
    const handleFormatDownload = async (e: React.MouseEvent, entry: FormatEntry) => {
        if (downloadingFormatId !== null) return;
        setDownloadingFormatId(entry.id);
        try {
            await Promise.resolve(onDownload(e, {
                ...book,
                id: entry.id,
                hash: entry.hash,
                extension: entry.extension,
                filesize: entry.filesize,
                filesizeString: entry.filesizeString,
            }));
        } finally {
            setDownloadingFormatId(null);
        }
    };

    // Use the externally provided (cached) cover URL, falling back to book.cover
    const resolvedCover = externalCoverUrl || book.cover;

    // Close on backdrop click
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    // Close on Escape
    React.useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    const metaItems = [
        book.author && { icon: <BookOpen size={14} />, label: "作者", value: book.author },
        book.publisher && { icon: <Layers size={14} />, label: "出版社", value: book.publisher },
        book.year && { icon: <Calendar size={14} />, label: "年份", value: String(book.year) },
        book.language && { icon: <Globe size={14} />, label: "语言", value: book.language.toUpperCase() },
        book.extension && { icon: <FileText size={14} />, label: "格式", value: book.extension.toUpperCase() },
        book.filesize && { icon: <Hash size={14} />, label: "大小", value: book.filesizeString || formatSize(book.filesize) },
        book.pages && { icon: <Layers size={14} />, label: "页数", value: `${book.pages} 页` },
    ].filter(Boolean) as { icon: React.ReactNode; label: string; value: string }[];

    return (
        <>
            <div
                className="modal-overlay"
                onClick={handleBackdropClick}
                style={{
                    animation: "fadeIn 200ms ease",
                }}
            >
                <div style={{
                    display: "flex",
                    gap: "0",
                    maxWidth: "720px",
                    width: "90vw",
                    maxHeight: "80vh",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-xl)",
                    overflow: "hidden",
                    boxShadow: "var(--shadow-lg), 0 0 60px rgba(0,0,0,0.4)",
                    animation: "slideUp 300ms ease",
                    position: "relative",
                }}>
                    {/* Close button */}
                    <button
                        onClick={onClose}
                        style={{
                            position: "absolute",
                            top: "12px",
                            right: "12px",
                            zIndex: 10,
                            width: "32px",
                            height: "32px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "50%",
                            border: "none",
                            background: "rgba(0,0,0,0.3)",
                            color: "var(--text-primary)",
                            cursor: "pointer",
                            transition: "all var(--transition-fast)",
                            backdropFilter: "blur(8px)",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.15)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.3)"; }}
                    >
                        <X size={16} />
                    </button>

                    {/* ===== Left: Book Cover ===== */}
                    <div style={{
                        width: "240px",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "32px 24px",
                        background: "linear-gradient(145deg, var(--bg-tertiary) 0%, var(--bg-primary) 100%)",
                        position: "relative",
                        overflow: "hidden",
                    }}>
                        {/* Ambient glow from cover */}
                        {resolvedCover && (
                            <div style={{
                                position: "absolute",
                                inset: 0,
                                backgroundImage: `url(${resolvedCover})`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                                filter: "blur(40px) brightness(0.4)",
                                opacity: 0.5,
                            }} />
                        )}

                        {/* Book with 3D spine effect */}
                        <div style={{
                            position: "relative",
                            width: "170px",
                            perspective: "800px",
                        }}>
                            <div style={{
                                position: "relative",
                                transformStyle: "preserve-3d",
                                transform: "rotateY(-8deg)",
                                transition: "transform var(--transition-slow)",
                            }}>
                                {/* Spine shadow */}
                                <div style={{
                                    position: "absolute",
                                    left: "-4px",
                                    top: "4px",
                                    width: "14px",
                                    height: "100%",
                                    background: "linear-gradient(90deg, rgba(0,0,0,0.5), rgba(0,0,0,0.1))",
                                    borderRadius: "2px 0 0 2px",
                                    transform: "rotateY(90deg) translateZ(7px)",
                                    transformOrigin: "left center",
                                }} />

                                {/* Cover */}
                                <div style={{
                                    width: "170px",
                                    aspectRatio: "2/3",
                                    borderRadius: "2px 8px 8px 2px",
                                    overflow: "hidden",
                                    boxShadow: `
                                    4px 4px 20px rgba(0,0,0,0.4),
                                    8px 8px 40px rgba(0,0,0,0.25),
                                    -2px 0 8px rgba(0,0,0,0.3)
                                `,
                                    background: "var(--bg-tertiary)",
                                }}>
                                    {resolvedCover && !coverFailed ? (
                                        <img
                                            src={resolvedCover}
                                            alt={book.title}
                                            style={{
                                                width: "100%",
                                                height: "100%",
                                                objectFit: "cover",
                                            }}
                                            onError={() => setCoverFailed(true)}
                                        />
                                    ) : (
                                        <div style={{
                                            width: "100%",
                                            height: "100%",
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: "12px",
                                            background: "linear-gradient(135deg, var(--bg-tertiary), var(--bg-secondary))",
                                            padding: "20px",
                                        }}>
                                            <BookOpen size={40} style={{ opacity: 0.2 }} />
                                            <div style={{
                                                fontSize: "12px",
                                                fontWeight: 600,
                                                color: "var(--text-muted)",
                                                textAlign: "center",
                                                lineHeight: 1.3,
                                                wordBreak: "break-word",
                                            }}>
                                                {book.title}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Paper edge effect */}
                                <div style={{
                                    position: "absolute",
                                    right: "-2px",
                                    top: "3px",
                                    width: "4px",
                                    height: "calc(100% - 6px)",
                                    background: "linear-gradient(90deg, #d4d4d4, #e8e8e8, #d4d4d4)",
                                    borderRadius: "0 1px 1px 0",
                                    opacity: 0.6,
                                }} />
                            </div>
                        </div>
                    </div>

                    {/* ===== Right: Book Details ===== */}
                    <div style={{
                        flex: 1,
                        padding: "28px 28px 24px",
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0",
                        minWidth: 0,
                    }}>
                        {/* Title */}
                        <h2 style={{
                            fontSize: "20px",
                            fontWeight: 700,
                            color: "var(--text-primary)",
                            lineHeight: 1.35,
                            marginBottom: "6px",
                            letterSpacing: "-0.3px",
                            paddingRight: "32px",
                        }}>
                            {book.title}
                        </h2>

                        {/* Author */}
                        {book.author && (
                            <p style={{
                                fontSize: "14px",
                                color: "var(--accent-light)",
                                fontWeight: 500,
                                marginBottom: "16px",
                            }}>
                                {book.author}
                            </p>
                        )}

                        {/* Meta tags row */}
                        <div style={{
                            display: "flex",
                            gap: "8px",
                            flexWrap: "wrap",
                            marginBottom: "20px",
                        }}>
                            {book.extension && (
                                <span className="badge badge-accent" style={{
                                    fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
                                }}>
                                    {book.extension}
                                </span>
                            )}
                            {book.year && (
                                <span className="badge" style={{
                                    fontSize: "11px",
                                    background: "var(--bg-tertiary)",
                                    color: "var(--text-secondary)",
                                }}>
                                    {book.year}
                                </span>
                            )}
                            {book.language && (
                                <span className="badge" style={{
                                    fontSize: "11px",
                                    background: "var(--bg-tertiary)",
                                    color: "var(--text-secondary)",
                                    textTransform: "uppercase",
                                }}>
                                    {book.language}
                                </span>
                            )}
                            {book.filesize && (
                                <span className="badge" style={{
                                    fontSize: "11px",
                                    background: "var(--bg-tertiary)",
                                    color: "var(--text-secondary)",
                                }}>
                                    {book.filesizeString || formatSize(book.filesize)}
                                </span>
                            )}
                            {book.pages && (
                                <span className="badge" style={{
                                    fontSize: "11px",
                                    background: "var(--bg-tertiary)",
                                    color: "var(--text-secondary)",
                                }}>
                                    {book.pages} 页
                                </span>
                            )}
                        </div>

                        {/* Divider */}
                        <div style={{
                            height: "1px",
                            background: "var(--border)",
                            marginBottom: "16px",
                        }} />

                        {/* Description */}
                        {book.description ? (
                            <div style={{ flex: 1, marginBottom: "20px" }}>
                                <h4 style={{
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    color: "var(--text-muted)",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.5px",
                                    marginBottom: "8px",
                                }}>
                                    简介
                                </h4>
                                <p style={{
                                    fontSize: "13px",
                                    lineHeight: 1.7,
                                    color: "var(--text-secondary)",
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                }}>
                                    {book.description}
                                </p>
                            </div>
                        ) : (
                            <div style={{
                                flex: 1,
                                marginBottom: "20px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "24px",
                                color: "var(--text-muted)",
                                fontSize: "13px",
                                background: "var(--bg-tertiary)",
                                borderRadius: "var(--radius-md)",
                            }}>
                                暂无简介
                            </div>
                        )}

                        {/* Detail meta grid */}
                        {metaItems.length > 0 && (
                            <div style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                                gap: "10px",
                                marginBottom: "20px",
                            }}>
                                {metaItems.map((item, idx) => (
                                    <div key={idx} style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        padding: "8px 12px",
                                        background: "var(--bg-tertiary)",
                                        borderRadius: "var(--radius-sm)",
                                        fontSize: "12px",
                                    }}>
                                        <span style={{ color: "var(--text-muted)", flexShrink: 0, display: "flex" }}>
                                            {item.icon}
                                        </span>
                                        <div style={{ minWidth: 0 }}>
                                            <div className="text-muted" style={{ fontSize: "10px", fontWeight: 500, marginBottom: "1px" }}>
                                                {item.label}
                                            </div>
                                            <div className="truncate" style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                                                {item.value}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Other format editions */}
                        <div style={{ marginBottom: "20px" }}>
                            <h4 style={{
                                fontSize: "12px",
                                fontWeight: 600,
                                color: "var(--text-muted)",
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                marginBottom: "8px",
                            }}>
                                其他格式版本
                            </h4>
                            {formats === null ? (
                                <div style={{
                                    display: "flex", alignItems: "center", gap: "6px",
                                    fontSize: "12px", color: "var(--text-muted)",
                                }}>
                                    <Loader2 size={13} className="spinner" /> 加载中...
                                </div>
                            ) : formatsError ? (
                                <div style={{
                                    fontSize: "12px", color: "var(--text-muted)",
                                    userSelect: "text", wordBreak: "break-all",
                                }}>
                                    获取失败：{formatsError}
                                </div>
                            ) : formats.length === 0 ? (
                                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                    库内暂无其他格式版本
                                </div>
                            ) : (
                                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                    {formats.map((f) => (
                                        <button
                                            key={f.id}
                                            onClick={(e) => handleFormatDownload(e, f)}
                                            disabled={downloadingFormatId !== null}
                                            title={`下载 ${f.extension.toUpperCase()} 版本`}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "6px",
                                                padding: "6px 10px",
                                                fontSize: "12px",
                                                fontWeight: 500,
                                                color: "var(--text-primary)",
                                                background: "var(--bg-tertiary)",
                                                border: "1px solid var(--border)",
                                                borderRadius: "var(--radius-sm)",
                                                cursor: downloadingFormatId !== null ? "default" : "pointer",
                                                opacity: downloadingFormatId !== null && downloadingFormatId !== f.id ? 0.5 : 1,
                                                transition: "all var(--transition-fast)",
                                            }}
                                            onMouseEnter={(e) => {
                                                if (downloadingFormatId === null)
                                                    e.currentTarget.style.borderColor = "var(--accent-light)";
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.borderColor = "var(--border)";
                                            }}
                                        >
                                            {downloadingFormatId === f.id
                                                ? <Loader2 size={12} className="spinner" />
                                                : <Download size={12} style={{ color: "var(--text-muted)" }} />}
                                            <span style={{ textTransform: "uppercase", fontWeight: 600 }}>
                                                {f.extension}
                                            </span>
                                            <span style={{ color: "var(--text-muted)" }}>
                                                {f.filesizeString || (f.filesize ? formatSize(f.filesize) : "")}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div style={{
                            display: "flex",
                            gap: "10px",
                            flexShrink: 0,
                        }}>
                            {/* Preview Button (only if readOnlineUrl exists) */}
                            {(book as any).readOnlineUrl && (
                                <button
                                    className="btn btn-secondary"
                                    onClick={async () => {
                                        setPreviewLoading(true);
                                        try {
                                            const url: string = await invoke("get_reader_url", {
                                                readOnlineUrl: (book as any).readOnlineUrl,
                                            });
                                            setReaderUrl(url);
                                        } catch (err) {
                                            console.error("Failed to get reader URL:", err);
                                        } finally {
                                            setPreviewLoading(false);
                                        }
                                    }}
                                    disabled={previewLoading}
                                    style={{
                                        padding: "12px",
                                        fontSize: "14px",
                                        fontWeight: 600,
                                        borderRadius: "var(--radius-lg)",
                                        flex: 1,
                                    }}
                                >
                                    {previewLoading ? (
                                        <><Loader2 size={16} className="spinner" /> 加载中...</>
                                    ) : (
                                        <><Eye size={16} /> 在线预览</>
                                    )}
                                </button>
                            )}

                            {/* Download Button */}
                            <button
                                className="btn btn-primary"
                                onClick={(e) => onDownload(e, book)}
                                disabled={isDownloading}
                                style={{
                                    padding: "12px",
                                    fontSize: "14px",
                                    fontWeight: 600,
                                    borderRadius: "var(--radius-lg)",
                                    flex: 1,
                                }}
                            >
                                {isDownloading ? (
                                    <><Loader2 size={16} className="spinner" /> 下载中...</>
                                ) : (
                                    <><Download size={16} /> 下载此书</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Reader Modal */}
            {readerUrl && (
                <ReaderModal
                    url={readerUrl}
                    title={book.title}
                    onClose={() => setReaderUrl(null)}
                />
            )}
        </>
    );
};

export default BookDetailModal;
