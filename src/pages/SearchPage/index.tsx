import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
    Search, Filter, Loader2, BookOpen,
    ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from "lucide-react";
import toast from "react-hot-toast";
import { useSearchState } from "../../hooks/useSearchState";
import { useCoverCache } from "../../hooks/useCoverCache";
import BookDetailModal from "../../components/BookDetailModal";
import DownloadLimitDialog, { isDownloadLimitError } from "../../components/DownloadLimitDialog";
import { animateDropToSidebar, playDownloadCompleteSound } from "../../utils/animations";
import type { Book, ViewMode } from "./types";
import { LANGUAGES, SEARCHMODE, EXTENSIONS } from "./constants";
import FilterPanel from "./FilterPanel";
import SearchToolbar from "./SearchToolbar";
import SearchGridView from "./SearchGridView";
import SearchListView from "./SearchListView";

export default function SearchPage() {
    const { state, updateState } = useSearchState();
    const [query, setQuery] = useState(state.query);
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>("grid");
    const [downloadingIds, setDownloadingIds] = useState<Set<number>>(new Set());
    const [hoveredId, setHoveredId] = useState<number | null>(null);
    const [selectedBook, setSelectedBook] = useState<Book | null>(null);
    const [limitError, setLimitError] = useState<string | null>(null);
    const [searchLimit, setSearchLimit] = useState(20);
    const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
    const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());

    const { getCoverUrl, handleCoverError } = useCoverCache();

    // Load downloaded history on mount
    useEffect(() => {
        invoke("get_download_history", { order: "date_down", page: 1, limit: 1000 })
            .then((result: any) => {
                if (result?.books) {
                    setDownloadedIds(new Set(result.books.map((b: any) => String(b.id))));
                }
            })
            .catch(() => {});
    }, []);

    // Load search_limit from config on mount
    useEffect(() => {
        invoke("get_config").then((cfg: any) => {
            if (cfg?.search_limit) setSearchLimit(cfg.search_limit);
        }).catch(() => { });
    }, []);

    // Listen for search from CommandPalette
    const searchFnRef = useRef<(q: string) => void>(() => {});
    const paletteHandledRef = useRef(false);
    useEffect(() => {
        const handler = (e: Event) => {
            const q = (e as CustomEvent).detail as string;
            if (q) {
                paletteHandledRef.current = true;
                setQuery(q);
                setTimeout(() => searchFnRef.current(q), 50);
            }
        };
        window.addEventListener("olib:palette-search", handler);
        return () => window.removeEventListener("olib:palette-search", handler);
    }, []);

    // Auto-trigger search on mount when CommandPalette set a pending query
    // (handles the case where SearchPage wasn't mounted when the event fired)
    useEffect(() => {
        if (!paletteHandledRef.current && state.query && !state.searched) {
            setQuery(state.query);
            setTimeout(() => searchFnRef.current(state.query), 100);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const updateSearchLimit = async (val: number) => {
        setSearchLimit(val);
        try {
            const cfg: any = await invoke("get_config");
            await invoke("set_config", { newConfig: { ...cfg, search_limit: val } });
        } catch (err) {
            console.error("Failed to save search_limit:", err);
        }
    };

    // Read persisted filter state
    const selectedLang = state.selectedLang;
    const selectedOrder = state.selectedOrder;
    const selectedExt = state.selectedExt;
    const exactMatch = state.exactMatch;



    // Batch check favorites when books change
    useEffect(() => {
        if (state.books.length === 0) return;
        const ids = state.books.map((b: Book) => String(b.id));
        invoke("check_favorites_batch", { bookIds: ids })
            .then((result: any) => {
                setFavoriteIds(new Set(result as string[]));
            })
            .catch(() => { });
    }, [state.books]);

    const handleSearch = async (page = 1, searchQuery?: string) => {
        const q = (searchQuery ?? query).trim();
        if (!q) return;
        setLoading(true);
        try {
            const langValue = LANGUAGES[selectedLang];
            const extValue = EXTENSIONS[selectedExt];
            const orderValue = SEARCHMODE[selectedOrder];

            const result: any = await invoke("search_books", {
                params: {
                    title: q,
                    page,
                    limit: searchLimit,
                    order: orderValue || null,
                    languages: langValue ? [langValue] : null,
                    extensions: extValue ? [extValue] : null,
                    year_from: null,
                    year_to: null,
                    exact: exactMatch,
                },
            });
            console.log("🔍 Search result:", result);
            updateState({
                query: q,
                books: result?.books || [],
                pagination: result?.pagination || {},
                currentPage: page,
                searched: true,
            });
        } catch (err) {
            console.error("❌ Search failed:", err);
            updateState({ books: [], searched: true });
        }
        setLoading(false);
    };

    // Keep searchFnRef in sync for the palette event handler
    searchFnRef.current = (q: string) => handleSearch(1, q);

    const handleDownload = async (e: React.MouseEvent, book: Book) => {
        e.stopPropagation();
        if (downloadingIds.has(book.id)) return;
        
        // Find rect for animation
        const button = e.currentTarget as HTMLElement;
        const cardNode = button.closest('.card');
        const coverRect = cardNode ? cardNode.getBoundingClientRect() : button.getBoundingClientRect();
        const coverUrl = getCoverUrl(String(book.id), book.cover) || "";

        setDownloadingIds(prev => new Set(prev).add(book.id));
        
        try {
            // Trigger animation immediately
            animateDropToSidebar(coverRect, coverUrl);

            const result = await invoke("download_book", {
                bookId: String(book.id), hashId: book.hash || "",
                title: book.title || "Unknown", extension: book.extension || "pdf",
            }) as string;
            console.log("✅ Download result:", result);
            setDownloadedIds(prev => new Set(prev).add(String(book.id)));
            // Only play sound for builtin downloads, not external dispatches
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
                playDownloadCompleteSound();
            }
        } catch (err) {
            console.error("❌ Download failed:", err);
            const errStr = String(err);
            if (isDownloadLimitError(errStr)) {
                setLimitError(errStr);
            } else if (errStr.includes("未登录") || errStr.includes("Please login") || errStr.includes("login")) {
                toast.error("请先登录：前往「设置」页面登录账号后再下载", { duration: 5000, icon: "🔒" });
            } else {
                console.error("Download error handled by global listener or suppressed:", err);
            }
        } finally {
            setDownloadingIds(prev => { const n = new Set(prev); n.delete(book.id); return n; });
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleSearch(1);
    };

    const handleToggleFavorite = async (book: Book) => {
        const bookId = String(book.id);
        const isFav = favoriteIds.has(bookId);
        try {
            if (isFav) {
                await invoke("remove_favorite", { bookId });
                setFavoriteIds(prev => { const n = new Set(prev); n.delete(bookId); return n; });
                toast.success("已取消收藏");
            } else {
                await invoke("add_favorite", {
                    params: {
                        book_id: bookId,
                        hash: book.hash || null,
                        title: book.title || "Unknown",
                        author: book.author || null,
                        publisher: book.publisher || null,
                        year: book.year || null,
                        language: book.language || null,
                        extension: book.extension || null,
                        filesize: book.filesize || null,
                        cover: book.cover || null,
                        description: book.description || null,
                        pages: book.pages || null,
                    },
                });
                setFavoriteIds(prev => new Set(prev).add(bookId));
                toast.success("已收藏");
            }
        } catch (err) {
            toast.error(String(err));
        }
    };

    const { books, pagination, currentPage, searched } = state;
    const totalPages = pagination.total_pages || 1;
    const hasNextPage = currentPage < totalPages;
    const hasPrevPage = currentPage > 1;
    const searchContentCh = `${Math.max(18, Math.min(48, query.trim().length + 2))}ch`;

    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            overflow: "hidden",
        }}>
            {/* ====== Sticky Top Area (Header + Search + Filters + Toolbar) ====== */}
            <div style={{
                flexShrink: 0,
                padding: "24px 24px 0",
                background: "var(--bg-primary)",
                zIndex: 10,
            }}>
                {/* Page Header */}
                <div className="page-header">
                    <h1 className="page-title">搜索</h1>
                    <p className="page-subtitle">搜索你想要的电子书</p>
                </div>

                {/* Search Bar */}
                <div className="search-bar search-bar-animated mb-4">
                    <div
                        className={`search-wrapper search-wrapper-animated ${isSearchFocused ? "is-focused" : ""}`}
                        style={{
                            width: isSearchFocused ? "100%" : `min(100%, calc(${searchContentCh} + 56px))`,
                        }}
                    >
                        <Search className="search-icon" size={18} />
                        <input
                            className="search-input"
                            placeholder="输入书名、作者或 ISBN..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onFocus={() => setIsSearchFocused(true)}
                            onBlur={() => setIsSearchFocused(false)}
                        />
                    </div>
                    <div className="search-actions">
                        <button
                            className="btn btn-ghost btn-icon"
                            onClick={() => setShowFilters(!showFilters)}
                            title="过滤"
                            style={{
                                borderColor: showFilters ? "var(--accent)" : undefined,
                                color: showFilters ? "var(--accent)" : undefined,
                            }}
                        >
                            <Filter size={18} />
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={() => handleSearch(1)}
                            disabled={loading}
                        >
                            {loading ? <Loader2 size={16} className="spinner" /> : <Search size={16} />}
                            搜索
                        </button>
                    </div>
                </div>

                {/* Filter Panel */}
                {showFilters && (
                    <FilterPanel
                        selectedLang={selectedLang}
                        selectedExt={selectedExt}
                        selectedOrder={selectedOrder}
                        exactMatch={exactMatch}
                        searchLimit={searchLimit}
                        onLangChange={(v) => updateState({ selectedLang: v })}
                        onExtChange={(v) => updateState({ selectedExt: v })}
                        onOrderChange={(v) => updateState({ selectedOrder: v })}
                        onExactMatchChange={(v) => updateState({ exactMatch: v })}
                        onSearchLimitChange={updateSearchLimit}
                    />
                )}

                {/* Results Toolbar */}
                {books.length > 0 && !loading && (
                    <SearchToolbar
                        totalItems={pagination.total_items || books.length}
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
                    />
                )}
            </div>

            {/* ====== Scrollable Content Area (Books only) ====== */}
            <div className="search-scroll-container" style={{
                flex: 1,
                overflowY: "scroll",
                padding: "0 24px 24px",
            }}>
                {/* Loading */}
                {loading ? (
                    <div className="empty-state">
                        <Loader2 size={40} className="spinner empty-state-icon" />
                        <p className="empty-state-text">正在搜索...</p>
                    </div>
                ) : books.length > 0 ? (
                    <>
                        {/* ====== Grid View ====== */}
                        {viewMode === "grid" ? (
                            <SearchGridView
                                books={books}
                                hoveredId={hoveredId}
                                setHoveredId={setHoveredId}
                                downloadingIds={downloadingIds}
                                favoriteIds={favoriteIds}
                                downloadedIds={downloadedIds}
                                getCoverUrl={getCoverUrl}
                                handleCoverError={handleCoverError}
                                onBookClick={(book) => setSelectedBook(book)}
                                onDownload={handleDownload}
                                onToggleFavorite={handleToggleFavorite}
                            />
                        ) : (
                            <SearchListView
                                books={books}
                                downloadingIds={downloadingIds}
                                favoriteIds={favoriteIds}
                                getCoverUrl={getCoverUrl}
                                handleCoverError={handleCoverError}
                                onBookClick={(book) => setSelectedBook(book)}
                                onDownload={handleDownload}
                                onToggleFavorite={handleToggleFavorite}
                            />
                        )}

                        {/* ====== Pagination ====== */}
                        {totalPages > 1 && (
                            <div style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "8px",
                                padding: "12px 0 24px",
                            }}>
                                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleSearch(1)} disabled={!hasPrevPage || loading} title="第一页">
                                    <ChevronsLeft size={16} />
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => handleSearch(currentPage - 1)} disabled={!hasPrevPage || loading}>
                                    <ChevronLeft size={16} />
                                    上一页
                                </button>

                                <div style={{
                                    padding: "6px 18px",
                                    background: "var(--bg-tertiary)",
                                    borderRadius: "var(--radius-md)",
                                    fontSize: "13px",
                                    fontWeight: 500,
                                    color: "var(--text-primary)",
                                    minWidth: "120px",
                                    textAlign: "center",
                                    border: "1px solid var(--border)",
                                }}>
                                    <span style={{ color: "var(--accent-light)", fontWeight: 700 }}>{currentPage}</span>
                                    <span className="text-muted"> / {totalPages}</span>
                                </div>

                                <button className="btn btn-secondary btn-sm" onClick={() => handleSearch(currentPage + 1)} disabled={!hasNextPage || loading}>
                                    下一页
                                    <ChevronRight size={16} />
                                </button>
                                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleSearch(totalPages)} disabled={!hasNextPage || loading} title="最后一页">
                                    <ChevronsRight size={16} />
                                </button>
                            </div>
                        )}
                    </>
                ) : searched ? (
                    <div className="empty-state">
                        <BookOpen size={40} className="empty-state-icon" />
                        <p className="empty-state-text">未找到相关书籍</p>
                        <p className="empty-state-hint">尝试换个关键词搜索</p>
                    </div>
                ) : (
                    <div className="empty-state">
                        <Search size={40} className="empty-state-icon" />
                        <p className="empty-state-text">输入关键词开始搜索</p>
                        <p className="empty-state-hint">支持按书名、作者搜索</p>
                    </div>
                )}
            </div>

            {/* Book Detail Modal */}
            {selectedBook && (
                <BookDetailModal
                    book={selectedBook}
                    coverUrl={getCoverUrl(String(selectedBook.id), selectedBook.cover)}
                    isDownloading={downloadingIds.has(selectedBook.id)}
                    onDownload={handleDownload}
                    onClose={() => setSelectedBook(null)}
                />
            )}

            {/* Download Limit Dialog */}
            {limitError && (
                <DownloadLimitDialog
                    message={limitError}
                    onSwitchAccount={() => {
                        window.dispatchEvent(new CustomEvent("olib:show-login"));
                    }}
                    onClose={() => setLimitError(null)}
                />
            )}
        </div>
    );
}
