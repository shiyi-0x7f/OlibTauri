import { useState, useRef, useEffect } from "react";
import { Search, Filter, Loader2, BookOpen, Wand2 } from "lucide-react";
import toast from "react-hot-toast";
import { getDownloadHistory } from "../../api/books";
import { getConfig, setConfig } from "../../api/config";
import { searchBooks } from "../../api/search";
import { downloadBook } from "../../api/download";
import { addFavorite, removeFavorite, checkFavoritesBatch } from "../../api/favorites";
import { useSearchState } from "../../hooks/useSearchState";
import { useCoverCache } from "../../hooks/useCoverCache";
import BookDetailModal from "../../components/BookDetailModal";
import DownloadLimitDialog, { isDownloadLimitError } from "../../components/DownloadLimitDialog";
import { describeDownloadError } from "../../utils/downloadError";
import { animateDropToSidebar, playDownloadCompleteSound } from "../../utils/animations";
import type { Book, ViewMode } from "./types";
import { LANGUAGES, SEARCHMODE, EXTENSIONS } from "./constants";
import { warnIgnored } from "../../utils/log";
import FilterPanel from "./FilterPanel";
import SearchToolbar from "./SearchToolbar";
import SearchGridView from "./SearchGridView";
import SearchListView from "./SearchListView";
import SearchPagination from "./SearchPagination";
import { usePrescriber, type AiInputType } from "./usePrescriber";
import { useLibraryMatch } from "./useLibraryMatch";
import { AiBookList, AiEmptyState, AiPromoCard, PrescriberLoginModal } from "./AiFinder";

type SearchMode = "search" | "ai";

export default function SearchPage() {
  const { state, updateState } = useSearchState();
  const prescriber = usePrescriber();
  const { matches: aiMatches, retry: retryAiMatch } = useLibraryMatch(
    prescriber.bag?.tips ?? null,
    prescriber.drawId,
  );
  // 搜书 / AI 寻书 两种模式共用一个输入区；AI 的描述与搜书关键词分开保存
  const [mode, setMode] = useState<SearchMode>("search");
  const [aiInput, setAiInput] = useState("");
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
    getDownloadHistory({ order: "date_down", page: 1, limit: 1000 })
      .then((result) => {
        if (result?.books) {
          setDownloadedIds(new Set(result.books.map((b) => String(b.id))));
        }
      })
      .catch(warnIgnored("get_download_history"));
  }, []);

  // Load search_limit from config on mount
  useEffect(() => {
    getConfig()
      .then((cfg) => {
        if (cfg?.search_limit) setSearchLimit(cfg.search_limit);
      })
      .catch(warnIgnored("get_config"));
  }, []);

  // Listen for search from CommandPalette
  const searchFnRef = useRef<(q: string) => void>(() => {});
  const paletteHandledRef = useRef(false);
  useEffect(() => {
    const handler = (e: Event) => {
      const q = (e as CustomEvent).detail as string;
      if (q) {
        paletteHandledRef.current = true;
        setMode("search");
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
      const cfg = await getConfig();
      await setConfig({ ...cfg, search_limit: val });
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
    checkFavoritesBatch(ids)
      .then((result) => {
        setFavoriteIds(new Set(result));
      })
      .catch(warnIgnored("check_favorites_batch"));
  }, [state.books]);

  const handleSearch = async (page = 1, searchQuery?: string) => {
    const q = (searchQuery ?? query).trim();
    if (!q) return;
    setLoading(true);
    try {
      const langValue = LANGUAGES[selectedLang];
      const extValue = EXTENSIONS[selectedExt];
      const orderValue = SEARCHMODE[selectedOrder];

      const result = await searchBooks({
        title: q,
        page,
        limit: searchLimit,
        order: orderValue || null,
        languages: langValue ? [langValue] : null,
        extensions: extValue ? [extValue] : null,
        year_from: null,
        year_to: null,
        exact: exactMatch,
      });
      updateState({
        query: q,
        // 搜索接口的书目 id 实际为 number（api 层为兼容热门接口标为 number | string）
        books: (result?.books || []) as Book[],
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

  const runAi = (text: string, inputType: AiInputType) => {
    setMode("ai");
    prescriber.diagnose(text, inputType);
  };

  // AI 书单里「N 个版本 / 换关键词搜」：切到搜书模式按书名搜索，书单仍可一键返回
  const searchFromAi = (title: string) => {
    setMode("search");
    setQuery(title);
    handleSearch(1, title);
  };

  const handleDownload = async (e: React.MouseEvent, book: Book) => {
    e.stopPropagation();
    if (downloadingIds.has(book.id)) return;

    // Find rect for animation
    const button = e.currentTarget as HTMLElement;
    const cardNode = button.closest(".card");
    const coverRect = cardNode ? cardNode.getBoundingClientRect() : button.getBoundingClientRect();
    const coverUrl = getCoverUrl(String(book.id), book.cover) || "";

    setDownloadingIds((prev) => new Set(prev).add(book.id));

    try {
      // Trigger animation immediately
      animateDropToSidebar(coverRect, coverUrl);

      const result = await downloadBook({
        bookId: String(book.id),
        hashId: book.hash || "",
        title: book.title || "Unknown",
        extension: book.extension || "pdf",
        author: book.author,
        cover: book.cover,
      });
      setDownloadedIds((prev) => new Set(prev).add(String(book.id)));
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
      } else if (
        errStr.includes("未登录") ||
        errStr.includes("Please login") ||
        errStr.includes("login")
      ) {
        toast.error("请先登录：前往「设置」页面登录账号后再下载", { duration: 5000, icon: "🔒" });
      } else {
        const text = describeDownloadError(err);
        if (text) toast.error(text, { duration: 6000 });
      }
    } finally {
      setDownloadingIds((prev) => {
        const n = new Set(prev);
        n.delete(book.id);
        return n;
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    if (mode === "ai") runAi(aiInput, "free");
    else handleSearch(1);
  };

  const handleToggleFavorite = async (book: Book) => {
    const bookId = String(book.id);
    const isFav = favoriteIds.has(bookId);
    try {
      if (isFav) {
        await removeFavorite(bookId);
        setFavoriteIds((prev) => {
          const n = new Set(prev);
          n.delete(bookId);
          return n;
        });
        toast.success("已取消收藏");
      } else {
        await addFavorite({
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
        });
        setFavoriteIds((prev) => new Set(prev).add(bookId));
        toast.success("已收藏");
      }
    } catch (err) {
      toast.error(String(err));
    }
  };

  const { books, pagination, currentPage, searched } = state;
  const totalPages = pagination.total_pages || 1;
  const searchContentCh = `${Math.max(18, Math.min(48, query.trim().length + 2))}ch`;

  const aiActions = {
    getCoverUrl,
    downloadingIds,
    downloadedIds,
    onDownload: handleDownload,
    onOpenBook: (book: Book) => setSelectedBook(book),
    onSearch: searchFromAi,
  };

  const searchResults = loading ? (
    <div className="empty-state">
      <Loader2 size={40} className="spinner empty-state-icon" />
      <p className="empty-state-text">正在搜索...</p>
    </div>
  ) : books.length > 0 ? (
    <>
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
      <SearchPagination
        currentPage={currentPage}
        totalPages={totalPages}
        loading={loading}
        onGo={(page) => handleSearch(page)}
      />
    </>
  ) : searched ? (
    <div className="empty-state">
      <BookOpen size={40} className="empty-state-icon" />
      <p className="empty-state-text">未找到相关书籍</p>
      <p className="empty-state-hint">尝试换个关键词，或切到「AI 寻书」描述你想读什么</p>
    </div>
  ) : (
    <>
      <div className="empty-state" style={{ paddingBottom: 24 }}>
        <Search size={40} className="empty-state-icon" />
        <p className="empty-state-text">输入关键词开始搜索</p>
        <p className="empty-state-hint">支持按书名、作者、ISBN 搜索</p>
      </div>
      <AiPromoCard onEnter={() => setMode("ai")} />
    </>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ====== Sticky Top Area (Header + Search + Filters + Toolbar) ====== */}
      <div
        style={{
          flexShrink: 0,
          padding: "24px 24px 0",
          background: "var(--bg-primary)",
          zIndex: 10,
        }}
      >
        {/* Page Header */}
        <div className="page-header">
          <h1 className="page-title">搜索</h1>
          <p className="page-subtitle">
            {mode === "ai"
              ? "说说你的状态或想读什么，AI 挑书并直接在书库里找好"
              : "按书名、作者或 ISBN 搜索电子书"}
          </p>
        </div>

        {/* Search Bar */}
        <div className="search-bar search-bar-animated with-mode mb-4">
          <div className="search-mode" role="tablist">
            <button
              role="tab"
              aria-selected={mode === "search"}
              className={mode === "search" ? "active" : ""}
              onClick={() => setMode("search")}
            >
              <Search size={14} /> 搜书
            </button>
            <button
              role="tab"
              aria-selected={mode === "ai"}
              className={`ai${mode === "ai" ? " active" : ""}`}
              onClick={() => setMode("ai")}
            >
              <Wand2 size={14} /> AI 寻书
            </button>
          </div>
          <div
            className={`search-wrapper search-wrapper-animated ${isSearchFocused ? "is-focused" : ""}${mode === "ai" ? " ai-mode" : ""}`}
            style={{
              width:
                isSearchFocused || mode === "ai"
                  ? "100%"
                  : `min(100%, calc(${searchContentCh} + 56px))`,
            }}
          >
            {mode === "ai" ? (
              <Wand2 className="search-icon" size={18} />
            ) : (
              <Search className="search-icon" size={18} />
            )}
            <input
              className="search-input"
              placeholder={
                mode === "ai" ? "例如：想入门心理学，最好通俗有趣一点" : "输入书名、作者或 ISBN..."
              }
              value={mode === "ai" ? aiInput : query}
              onChange={(e) =>
                mode === "ai" ? setAiInput(e.target.value) : setQuery(e.target.value)
              }
              onKeyDown={handleKeyDown}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
            />
          </div>
          <div className="search-actions">
            {mode === "ai" ? (
              <button
                className="btn btn-primary"
                onClick={() => runAi(aiInput, "free")}
                disabled={prescriber.loading}
              >
                {prescriber.loading ? (
                  <Loader2 size={16} className="spinner" />
                ) : (
                  <Wand2 size={16} />
                )}
                AI 寻书
              </button>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>

        {/* Filter Panel */}
        {mode === "search" && showFilters && (
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
        {mode === "search" && books.length > 0 && !loading && (
          <SearchToolbar
            totalItems={pagination.total_items || books.length}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        )}
      </div>

      {/* ====== Scrollable Content Area (Books only) ====== */}
      <div
        className="search-scroll-container"
        style={{
          flex: 1,
          overflowY: "scroll",
          padding: "0 24px 24px",
        }}
      >
        {mode === "ai" ? (
          <>
            <AiBookList
              prescriber={prescriber}
              matches={aiMatches}
              onRetryMatch={retryAiMatch}
              collapsed={false}
              actions={aiActions}
            />
            {!prescriber.loading && !prescriber.bag && (
              <AiEmptyState
                disabled={prescriber.loading}
                history={prescriber.history}
                onPick={runAi}
                onRestore={prescriber.restore}
                onRemove={prescriber.removeHistory}
              />
            )}
          </>
        ) : (
          <>
            {/* 搜书模式下保留 AI 书单入口（收起为一条），点「展开」回到 AI 模式 */}
            {(prescriber.bag || prescriber.loading) && (
              <AiBookList
                prescriber={prescriber}
                matches={aiMatches}
                onRetryMatch={retryAiMatch}
                collapsed
                onToggle={() => setMode("ai")}
                actions={aiActions}
              />
            )}
            {searchResults}
          </>
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

      <PrescriberLoginModal login={prescriber.login} />

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
