import type { MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  History,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Shuffle,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import type { AiHistoryEntry, Prescriber, PrescriberLogin } from "./usePrescriber";
import type { MatchState } from "./useLibraryMatch";
import type { ReadingTip } from "../../api/prescriber";
import type { Book } from "./types";
import AiBookshelf, { AiLoading } from "./AiBookshelf";
import type { AiInputType } from "./usePrescriber";

function timeAgo(at: number): string {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

/* ───────────── 空状态 ───────────── */

/** 搜书模式空状态：引导切到 AI 寻书 */
export function AiPromoCard({ onEnter }: { onEnter: () => void }) {
  return (
    <button className="ai-promo" onClick={onEnter}>
      <span className="ai-finder-icon lg">
        <Wand2 size={20} />
      </span>
      <span style={{ flex: 1, textAlign: "left" }}>
        <span className="ai-promo-title">不知道读什么？试试 AI 寻书</span>
        <span className="ai-promo-sub">
          说说你的状态或想学的东西，AI 帮你挑几本，并直接在书库里找好
        </span>
      </span>
      <ArrowRight size={18} />
    </button>
  );
}

interface EmptyProps {
  disabled: boolean;
  history: AiHistoryEntry[];
  onPick: (input: string, inputType: AiInputType) => void;
  onRestore: (entry: AiHistoryEntry) => void;
  onRemove: (entry: AiHistoryEntry) => void;
}

/** AI 模式空状态：书架抽书 + 最近的书单（本地重开不耗配额） */
export function AiEmptyState({ disabled, history, onPick, onRestore, onRemove }: EmptyProps) {
  return (
    <div className="ai-empty">
      <AiBookshelf disabled={disabled} onPick={onPick} />

      {history.length > 0 && (
        <>
          <div className="ai-empty-title" style={{ marginTop: 24 }}>
            <History size={15} /> 最近的书单
            <span className="ai-empty-hint">重新打开不消耗 AI 次数</span>
          </div>
          <div className="ai-history">
            {history.map((h) => (
              <div key={h.at} className="ai-history-item" onClick={() => onRestore(h)}>
                <div className="ai-history-label">{h.label}</div>
                <div className="ai-history-books">
                  {h.bag.tips.map((t) => `《${t.book_name}》`).join("")}
                </div>
                <div className="ai-history-meta">
                  <Clock size={11} /> {timeAgo(h.at)} · {h.bag.tips.length} 本
                </div>
                <button
                  className="ai-history-remove"
                  title="删除这条记录"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(h);
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────── 结果：AI 书单 ───────────── */

export interface BookActions {
  getCoverUrl: (bookId: string, fallbackUrl?: string) => string | undefined;
  downloadingIds: Set<number>;
  downloadedIds: Set<string>;
  onDownload: (e: ReactMouseEvent, book: Book) => void;
  onOpenBook: (book: Book) => void;
  /** 按书名普通搜索（看全部版本 / 换关键词） */
  onSearch: (title: string) => void;
}

interface ListProps {
  prescriber: Prescriber;
  matches: Record<number, MatchState>;
  onRetryMatch: () => void;
  /** 收起为一条（搜书模式下展示）；onToggle 存在时显示「展开」按钮 */
  collapsed: boolean;
  onToggle?: () => void;
  actions: BookActions;
}

export function AiBookList({
  prescriber,
  matches,
  onRetryMatch,
  collapsed,
  onToggle,
  actions,
}: ListProps) {
  const { loading, loadingLine, bag, query, drawId } = prescriber;
  if (!loading && !bag) return null;

  const found = bag ? Object.values(matches).filter((m) => m.status === "found").length : 0;

  return (
    <div className="ai-list">
      <div className="ai-list-head">
        <span className="ai-finder-icon">
          <Sparkles size={15} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="ai-list-title">
            {loading ? "AI 正在为你挑书" : `AI 书单 · ${bag?.tips.length ?? 0} 本`}
            {!loading && bag && <span className="ai-list-found">书库已找到 {found} 本</span>}
          </div>
          {query && <div className="ai-list-query">你说：{query.label}</div>}
        </div>
        {!loading && bag && (
          <div className="ai-list-actions">
            <button
              className="btn btn-ghost btn-sm"
              onClick={prescriber.again}
              title="同一需求再要一批"
            >
              <Shuffle size={13} /> 换一批
            </button>
            {onToggle && (
              <button className="btn btn-ghost btn-sm" onClick={onToggle}>
                {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                {collapsed ? "回到书单" : "收起"}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={prescriber.clear} title="关闭书单">
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <AiLoading line={loadingLine} />
      ) : bag && collapsed ? (
        <div className="ai-list-collapsed">
          {bag.tips.map((t, i) => (
            <span key={i}>{t.book_name}</span>
          ))}
        </div>
      ) : bag ? (
        <>
          {bag.diagnosis && <div className="ai-diagnosis ai-enter">{bag.diagnosis}</div>}
          {/* key 随每次抽取变化，换一批时重新播放入场动画 */}
          <div className="ai-books" key={drawId}>
            {bag.tips.map((tip, i) => (
              <div key={i} className="ai-enter" style={{ animationDelay: `${60 + i * 50}ms` }}>
                <AiBookRow
                  tip={tip}
                  index={i}
                  match={matches[i] ?? { status: "loading" }}
                  onRetryMatch={onRetryMatch}
                  actions={actions}
                />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function AiBookRow({
  tip,
  index,
  match,
  onRetryMatch,
  actions,
}: {
  tip: ReadingTip;
  index: number;
  match: MatchState;
  onRetryMatch: () => void;
  actions: BookActions;
}) {
  const book = match.status === "found" ? match.book : null;
  const cover = book ? actions.getCoverUrl(String(book.id), book.cover) : undefined;
  const downloading = book ? actions.downloadingIds.has(book.id) : false;
  const downloaded = book ? actions.downloadedIds.has(String(book.id)) : false;

  return (
    <div className="ai-book">
      <div
        className={`ai-book-cover${book ? " clickable" : ""}`}
        onClick={() => book && actions.onOpenBook(book)}
      >
        {cover ? (
          <img src={cover} alt={tip.book_name} loading="lazy" />
        ) : (
          <div className="ai-book-cover-fallback">{tip.book_name}</div>
        )}
        <span className="ai-book-rank">{index + 1}</span>
      </div>

      <div className="ai-book-body">
        <div className="ai-book-title-row">
          <span className="ai-book-title">{tip.book_name}</span>
          {tip.category && <span className="ai-book-cat">{tip.category}</span>}
        </div>
        <div className="ai-book-author">{tip.author || "佚名"}</div>
        <div className="ai-book-reason" title={tip.reason}>
          {tip.reason}
        </div>

        <div className="ai-book-match">
          {match.status === "loading" && (
            <span className="ai-match-note">
              <Loader2 size={12} className="spin" /> 正在书库中查找…
            </span>
          )}
          {match.status === "found" && book && (
            <>
              <span className="ai-match-chip">
                <BookOpen size={11} />
                {(book.extension || "?").toUpperCase()}
                {book.filesizeString ? ` · ${book.filesizeString}` : ""}
              </span>
              <button
                className={`ai-match-btn primary${downloaded ? " done" : ""}`}
                disabled={downloading}
                onClick={(e) => actions.onDownload(e, book)}
              >
                {downloading ? (
                  <Loader2 size={12} className="spin" />
                ) : downloaded ? (
                  <Check size={12} />
                ) : (
                  <Download size={12} />
                )}
                {downloaded ? "已下载" : "下载"}
              </button>
              <button className="ai-match-btn" onClick={() => actions.onOpenBook(book)}>
                详情
              </button>
              {match.editions > 1 && (
                <button className="ai-match-btn" onClick={() => actions.onSearch(tip.book_name)}>
                  <Layers size={12} /> {match.editions} 个版本
                </button>
              )}
            </>
          )}
          {match.status === "none" && (
            <>
              <span className="ai-match-note">书库暂未收录</span>
              <button className="ai-match-btn" onClick={() => actions.onSearch(tip.book_name)}>
                <Search size={12} /> 换关键词搜
              </button>
            </>
          )}
          {match.status === "error" && (
            <>
              <span className="ai-match-note error" title={match.error}>
                书库查找失败
              </span>
              <button className="ai-match-btn" onClick={onRetryMatch}>
                <RefreshCw size={12} /> 重试
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────── 登录 ───────────── */

/** AI 寻书需公众号扫码登录（scc 统一身份） */
export function PrescriberLoginModal({ login }: { login: PrescriberLogin }) {
  if (!login.open) return null;
  return (
    <div
      className="prescriber-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) login.close();
      }}
    >
      <div className="prescriber-modal">
        <div className="prescriber-modal-title">微信扫码登录</div>
        <div className="prescriber-modal-sub">AI 寻书需登录后使用，请用微信扫码</div>
        <div className="prescriber-qr">
          {login.qrUrl ? (
            <img src={login.qrUrl} alt="二维码" width={200} height={200} />
          ) : (
            <Loader2 size={24} className="spin" color="#888" />
          )}
          {login.expired && (
            <div className="prescriber-qr-mask">
              二维码已过期
              <button className="btn btn-primary btn-sm" onClick={login.refresh}>
                <RefreshCw size={12} /> 刷新
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
