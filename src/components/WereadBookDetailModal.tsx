import React, { useEffect, useRef, useState } from "react";
import {
  X,
  Loader2,
  BookOpen,
  Highlighter,
  MessageSquare,
  Star,
  Users,
  Search,
  FileDown,
  Compass,
  Sparkles,
} from "lucide-react";
import WereadSimilarBooks from "./WereadSimilarBooks";
import WereadAskPanel, { type PendingQuestion } from "./WereadAskPanel";
import { save } from "@tauri-apps/plugin-dialog";
import toast from "react-hot-toast";
import { warnIgnored } from "../utils/log";
import { searchInLibrary } from "../utils/searchInLibrary";
import { buildNotesMarkdown, sanitizeFilename } from "../utils/wereadExport";
import {
  wereadGetBookInfo,
  wereadGetChapters,
  wereadGetBookmarks,
  wereadGetMyReviews,
  wereadGetBestBookmarks,
  wereadSaveNotes,
  type WereadBookInfo as BookInfo,
  type WereadChapter as Chapter,
  type WereadBookmark as Bookmark,
  type WereadReview as MyReview,
  type WereadBestBookmark as BestBookmark,
} from "../api/weread";

interface WereadBookDetailModalProps {
  bookId: string;
  onClose: () => void;
  /** 在弹窗内切换到另一本书（相似书点击） */
  onOpenBook: (bookId: string) => void;
}

type Tab = "info" | "highlights" | "thoughts" | "popular" | "similar" | "ai";

const WereadBookDetailModal: React.FC<WereadBookDetailModalProps> = ({
  bookId,
  onClose,
  onOpenBook,
}) => {
  const [loading, setLoading] = useState(true);
  const [bookInfo, setBookInfo] = useState<BookInfo | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [myReviews, setMyReviews] = useState<MyReview[]>([]);
  const [bestBookmarks, setBestBookmarks] = useState<BestBookmark[]>([]);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("highlights");
  // AI 面板首次打开后保持挂载（切标签不丢对话）；状态按 bookId 归属，换书自然失效
  const [aiVisitedFor, setAiVisitedFor] = useState<string | null>(null);
  const [pendingAsk, setPendingAsk] = useState<(PendingQuestion & { bookId: string }) | null>(null);
  const askNonce = useRef(0);
  const aiVisited = aiVisitedFor === bookId;

  const openTab = (tab: Tab) => {
    if (tab === "ai") setAiVisitedFor(bookId);
    setActiveTab(tab);
  };

  const askAboutHighlight = (markText: string) => {
    askNonce.current += 1;
    setPendingAsk({
      bookId,
      query: `「${markText.trim()}」这句话是什么意思？`,
      label: "解读划线",
      nonce: askNonce.current,
    });
    openTab("ai");
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    loadData();
  }, [bookId]);

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const info = await wereadGetBookInfo(bookId);
      setBookInfo(info);

      const [chaptersData, bookmarksData, reviewsData, bestData] = await Promise.all([
        wereadGetChapters(bookId).catch(warnIgnored("weread_get_chapters")),
        wereadGetBookmarks(bookId).catch(warnIgnored("weread_get_bookmarks")),
        wereadGetMyReviews(bookId).catch(warnIgnored("weread_get_my_reviews")),
        wereadGetBestBookmarks(bookId).catch(warnIgnored("weread_get_best_bookmarks")),
      ]);

      const marks = bookmarksData?.updated || [];
      // 条目可能是 { review } 包装也可能直接平铺（见 api/weread WereadReviewItem 注释）
      const reviews = (reviewsData?.reviews || []).map(
        (r) => r.review || (r as unknown as MyReview),
      );
      setChapters(chaptersData?.chapters || []);
      setBookmarks(marks);
      setMyReviews(reviews);
      setBestBookmarks(bestData?.items || []);
      // 推荐 / 相似书打开的多是没读过的书：没有个人笔记时直接落在「详情」
      setActiveTab(marks.length === 0 && reviews.length === 0 ? "info" : "highlights");
    } catch (err) {
      setError(String(err ?? "") || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const chapterMap = new Map(chapters.map((c) => [c.chapterUid, c.title]));

  const handleExport = async () => {
    if (!bookInfo) return;
    try {
      const path = await save({
        title: "导出微信读书笔记",
        defaultPath: `${sanitizeFilename(bookInfo.title)}-微信读书笔记.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      const md = buildNotesMarkdown(bookInfo, chapters, bookmarks, myReviews);
      await wereadSaveNotes(path, md);
      toast.success("笔记已导出", { icon: "📝" });
    } catch (err) {
      toast.error(`导出失败：${String(err)}`);
    }
  };

  const formatRating = (rating?: number) => {
    if (!rating) return null;
    return (rating / 10).toFixed(1);
  };

  const formatWordCount = (count?: number) => {
    if (!count) return null;
    if (count >= 10000) return `${(count / 10000).toFixed(1)}万字`;
    return `${count}字`;
  };

  const formatTime = (ts?: number) => {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const tabs: { key: Tab; label: string; count: number; icon: React.ReactNode }[] = [
    { key: "highlights", label: "划线", count: bookmarks.length, icon: <Highlighter size={14} /> },
    { key: "thoughts", label: "想法", count: myReviews.length, icon: <MessageSquare size={14} /> },
    { key: "popular", label: "热门划线", count: bestBookmarks.length, icon: <Star size={14} /> },
    { key: "info", label: "详情", count: 0, icon: <BookOpen size={14} /> },
    { key: "similar", label: "相似书", count: 0, icon: <Compass size={14} /> },
    { key: "ai", label: "AI 问书", count: 0, icon: <Sparkles size={14} /> },
  ];

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          width: "720px",
          maxHeight: "85vh",
          borderRadius: "20px",
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            gap: "16px",
          }}
        >
          {bookInfo?.cover && (
            <img
              src={bookInfo.cover}
              alt=""
              style={{
                width: "48px",
                height: "64px",
                borderRadius: "6px",
                objectFit: "cover",
                flexShrink: 0,
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {bookInfo?.title || "加载中..."}
            </div>
            {bookInfo?.author && (
              <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>
                {bookInfo.author}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
              {formatRating(bookInfo?.newRating) && (
                <span
                  style={{
                    fontSize: "11px",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: "rgba(245,158,11,0.12)",
                    color: "#f59e0b",
                    fontWeight: 600,
                  }}
                >
                  ★ {formatRating(bookInfo?.newRating)}
                </span>
              )}
              {formatWordCount(bookInfo?.wordCount) && (
                <span
                  style={{
                    fontSize: "11px",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: "var(--bg-tertiary)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {formatWordCount(bookInfo?.wordCount)}
                </span>
              )}
              {bookInfo?.category && (
                <span
                  style={{
                    fontSize: "11px",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: "var(--bg-tertiary)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {bookInfo.category}
                </span>
              )}
            </div>
          </div>
          {bookInfo?.title && !loading && (
            <button
              onClick={handleExport}
              title="导出划线和想法为 Markdown"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                flexShrink: 0,
                padding: "8px 14px",
                borderRadius: "10px",
                cursor: "pointer",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: "13px",
                fontWeight: 500,
              }}
            >
              <FileDown size={14} />
              导出笔记
            </button>
          )}
          {bookInfo?.title && (
            <button
              onClick={() => {
                onClose();
                searchInLibrary(bookInfo.title);
              }}
              title="去 Z 站搜索下载电子书"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                flexShrink: 0,
                padding: "8px 14px",
                borderRadius: "10px",
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              <Search size={14} />
              找电子书
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: "8px",
              borderRadius: "8px",
              border: "none",
              background: "var(--bg-tertiary)",
              cursor: "pointer",
              color: "var(--text-secondary)",
              flexShrink: 0,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "60px",
            }}
          >
            <Loader2 className="spin" size={28} style={{ color: "var(--text-secondary)" }} />
          </div>
        ) : error ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "40px",
              color: "#ef4444",
            }}
          >
            {error}
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div
              style={{
                display: "flex",
                gap: "4px",
                padding: "12px 20px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => openTab(tab.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 14px",
                    borderRadius: "10px",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: activeTab === tab.key ? 600 : 400,
                    background: activeTab === tab.key ? "var(--accent)" : "transparent",
                    color: activeTab === tab.key ? "#fff" : "var(--text-secondary)",
                    transition: "all 0.15s ease",
                  }}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.count > 0 && (
                    <span style={{ fontSize: "11px", opacity: 0.8 }}>({tab.count})</span>
                  )}
                </button>
              ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              {activeTab === "highlights" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {bookmarks.length === 0 ? (
                    <EmptyTab text="暂无划线" />
                  ) : (
                    bookmarks.map((bm) => (
                      <div
                        key={bm.bookmarkId}
                        style={{
                          padding: "14px 16px",
                          borderRadius: "12px",
                          background: "var(--bg-secondary)",
                          borderLeft: `3px solid ${bm.style === 1 ? "#f59e0b" : bm.style === 2 ? "#ef4444" : "var(--accent)"}`,
                        }}
                      >
                        <div
                          style={{
                            fontSize: "14px",
                            color: "var(--text-primary)",
                            lineHeight: "1.6",
                          }}
                        >
                          {bm.markText}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginTop: "8px",
                            fontSize: "11px",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {bm.chapterUid && chapterMap.has(bm.chapterUid) && (
                            <span>— {chapterMap.get(bm.chapterUid)}</span>
                          )}
                          {bm.markText.trim() && (
                            <button
                              className="wr-ask-chip"
                              style={{ marginLeft: "auto", padding: "3px 10px", fontSize: "11px" }}
                              onClick={() => askAboutHighlight(bm.markText)}
                              title="让 AI 解读这段划线"
                            >
                              <Sparkles size={11} />问 AI
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "thoughts" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {myReviews.length === 0 ? (
                    <EmptyTab text="暂无想法" />
                  ) : (
                    myReviews.map((r) => (
                      <div
                        key={r.reviewId}
                        style={{
                          padding: "14px 16px",
                          borderRadius: "12px",
                          background: "var(--bg-secondary)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {r.abstract_ && (
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--text-secondary)",
                              lineHeight: "1.5",
                              padding: "8px 12px",
                              borderRadius: "8px",
                              background: "var(--bg-tertiary)",
                              marginBottom: "10px",
                              borderLeft: "2px solid var(--accent)",
                            }}
                          >
                            {r.abstract_}
                          </div>
                        )}
                        <div
                          style={{
                            fontSize: "14px",
                            color: "var(--text-primary)",
                            lineHeight: "1.6",
                          }}
                        >
                          {r.content}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: "12px",
                            marginTop: "8px",
                            fontSize: "11px",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {r.chapterName && <span>{r.chapterName}</span>}
                          {r.createTime && <span>{formatTime(r.createTime)}</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "popular" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {bestBookmarks.length === 0 ? (
                    <EmptyTab text="暂无热门划线" />
                  ) : (
                    bestBookmarks.map((bm) => (
                      <div
                        key={bm.bookmarkId}
                        style={{
                          padding: "14px 16px",
                          borderRadius: "12px",
                          background: "var(--bg-secondary)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "14px",
                            color: "var(--text-primary)",
                            lineHeight: "1.6",
                          }}
                        >
                          {bm.markText}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            marginTop: "8px",
                          }}
                        >
                          <Users size={12} style={{ color: "var(--text-secondary)" }} />
                          <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                            {bm.totalCount} 人标注
                          </span>
                          {chapterMap.has(bm.chapterUid) && (
                            <span
                              style={{
                                fontSize: "11px",
                                color: "var(--text-secondary)",
                                marginLeft: "8px",
                              }}
                            >
                              — {chapterMap.get(bm.chapterUid)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "similar" && (
                <WereadSimilarBooks bookId={bookId} onOpenBook={onOpenBook} />
              )}

              {aiVisited && (
                <div style={{ display: activeTab === "ai" ? "block" : "none", height: "100%" }}>
                  <WereadAskPanel
                    key={bookId}
                    bookId={bookId}
                    bookTitle={bookInfo?.title}
                    pending={pendingAsk?.bookId === bookId ? pendingAsk : null}
                  />
                </div>
              )}

              {activeTab === "info" && bookInfo && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {bookInfo.intro && (
                    <div>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "var(--text-primary)",
                          marginBottom: "8px",
                        }}
                      >
                        简介
                      </div>
                      <div
                        style={{
                          fontSize: "13px",
                          color: "var(--text-secondary)",
                          lineHeight: "1.7",
                        }}
                      >
                        {bookInfo.intro}
                      </div>
                    </div>
                  )}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "8px",
                      padding: "16px",
                      borderRadius: "12px",
                      background: "var(--bg-secondary)",
                    }}
                  >
                    {bookInfo.publisher && <InfoItem label="出版社" value={bookInfo.publisher} />}
                    {bookInfo.publishTime && (
                      <InfoItem label="出版时间" value={bookInfo.publishTime} />
                    )}
                    {bookInfo.isbn && <InfoItem label="ISBN" value={bookInfo.isbn} />}
                    {bookInfo.category && <InfoItem label="分类" value={bookInfo.category} />}
                    {bookInfo.newRatingCount && (
                      <InfoItem label="评价人数" value={`${bookInfo.newRatingCount}`} />
                    )}
                    {formatWordCount(bookInfo.wordCount) && (
                      <InfoItem label="字数" value={formatWordCount(bookInfo.wordCount)!} />
                    )}
                  </div>

                  {chapters.length > 0 && (
                    <div>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "var(--text-primary)",
                          marginBottom: "8px",
                        }}
                      >
                        目录 ({chapters.length} 章)
                      </div>
                      <div
                        style={{
                          maxHeight: "300px",
                          overflowY: "auto",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        {chapters.map((ch) => (
                          <div
                            key={ch.chapterUid}
                            style={{
                              fontSize: "13px",
                              color: "var(--text-secondary)",
                              padding: "6px 10px",
                              borderRadius: "6px",
                              background: "var(--bg-secondary)",
                            }}
                          >
                            {ch.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

function EmptyTab({ text }: { text: string }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "40px",
        color: "var(--text-secondary)",
        fontSize: "14px",
      }}
    >
      {text}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "2px" }}>
        {label}
      </div>
      <div style={{ fontSize: "13px", color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

export default WereadBookDetailModal;
