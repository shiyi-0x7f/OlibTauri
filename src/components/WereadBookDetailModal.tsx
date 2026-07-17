import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Loader2, BookOpen, Highlighter, MessageSquare, Star, Users, Search, FileDown } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import toast from "react-hot-toast";
import { searchInLibrary } from "../utils/searchInLibrary";
import { buildNotesMarkdown, sanitizeFilename } from "../utils/wereadExport";

interface WereadBookDetailModalProps {
  bookId: string;
  onClose: () => void;
}

interface BookInfo {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  intro?: string;
  category?: string;
  publisher?: string;
  publishTime?: string;
  isbn?: string;
  wordCount?: number;
  newRating?: number;
  newRatingCount?: number;
}

interface Chapter {
  chapterUid: number;
  chapterIdx: number;
  title: string;
  wordCount?: number;
}

interface Bookmark {
  bookmarkId: string;
  chapterUid?: number;
  range: string;
  markText: string;
  createTime?: number;
  style?: number;
}

interface MyReview {
  reviewId: string;
  content: string;
  createTime?: number;
  chapterName?: string;
  abstract_?: string;
}

interface BestBookmark {
  bookmarkId: string;
  chapterUid: number;
  markText: string;
  totalCount: number;
}

type Tab = "info" | "highlights" | "thoughts" | "popular";

const WereadBookDetailModal: React.FC<WereadBookDetailModalProps> = ({ bookId, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [bookInfo, setBookInfo] = useState<BookInfo | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [myReviews, setMyReviews] = useState<MyReview[]>([]);
  const [bestBookmarks, setBestBookmarks] = useState<BestBookmark[]>([]);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("highlights");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
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
      const info: any = await invoke("weread_get_book_info", { bookId });
      setBookInfo(info);

      const [chaptersData, bookmarksData, reviewsData, bestData] = await Promise.all([
        invoke("weread_get_chapters", { bookId }).catch(() => null),
        invoke("weread_get_bookmarks", { bookId }).catch(() => null),
        invoke("weread_get_my_reviews", { bookId }).catch(() => null),
        invoke("weread_get_best_bookmarks", { bookId }).catch(() => null),
      ]);

      if (chaptersData) setChapters((chaptersData as any).chapters || []);
      if (bookmarksData) setBookmarks((bookmarksData as any).updated || []);
      if (reviewsData) {
        const reviews = ((reviewsData as any).reviews || []).map((r: any) => r.review || r);
        setMyReviews(reviews);
      }
      if (bestData) setBestBookmarks((bestData as any).items || []);
    } catch (err: any) {
      setError(err?.toString() || "加载失败");
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
      await invoke("weread_save_notes", { path, content: md });
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
  ];

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)",
      }}
    >
      <div style={{
        width: "720px", maxHeight: "85vh", borderRadius: "20px",
        background: "var(--bg-primary)", border: "1px solid var(--border)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--border)", gap: "16px" }}>
          {bookInfo?.cover && (
            <img
              src={bookInfo.cover}
              alt=""
              style={{ width: "48px", height: "64px", borderRadius: "6px", objectFit: "cover", flexShrink: 0 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {bookInfo?.title || "加载中..."}
            </div>
            {bookInfo?.author && (
              <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>{bookInfo.author}</div>
            )}
            <div style={{ display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
              {formatRating(bookInfo?.newRating) && (
                <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "6px", background: "rgba(245,158,11,0.12)", color: "#f59e0b", fontWeight: 600 }}>
                  ★ {formatRating(bookInfo?.newRating)}
                </span>
              )}
              {formatWordCount(bookInfo?.wordCount) && (
                <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "6px", background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}>
                  {formatWordCount(bookInfo?.wordCount)}
                </span>
              )}
              {bookInfo?.category && (
                <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "6px", background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}>
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
                display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
                padding: "8px 14px", borderRadius: "10px", cursor: "pointer",
                border: "1px solid var(--border)", background: "transparent",
                color: "var(--text-secondary)", fontSize: "13px", fontWeight: 500,
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
                display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
                padding: "8px 14px", borderRadius: "10px", border: "none",
                background: "var(--accent)", color: "#fff", cursor: "pointer",
                fontSize: "13px", fontWeight: 600,
              }}
            >
              <Search size={14} />
              找电子书
            </button>
          )}
          <button
            onClick={onClose}
            style={{ padding: "8px", borderRadius: "8px", border: "none", background: "var(--bg-tertiary)", cursor: "pointer", color: "var(--text-secondary)", flexShrink: 0 }}
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "60px" }}>
            <Loader2 className="spin" size={28} style={{ color: "var(--text-secondary)" }} />
          </div>
        ) : error ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px", color: "#ef4444" }}>
            {error}
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div style={{ display: "flex", gap: "4px", padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "8px 14px", borderRadius: "10px", border: "none", cursor: "pointer",
                    fontSize: "13px", fontWeight: activeTab === tab.key ? 600 : 400,
                    background: activeTab === tab.key ? "var(--accent)" : "transparent",
                    color: activeTab === tab.key ? "#fff" : "var(--text-secondary)",
                    transition: "all 0.15s ease",
                  }}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.count > 0 && <span style={{ fontSize: "11px", opacity: 0.8 }}>({tab.count})</span>}
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
                      <div key={bm.bookmarkId} style={{
                        padding: "14px 16px", borderRadius: "12px", background: "var(--bg-secondary)",
                        borderLeft: `3px solid ${bm.style === 1 ? "#f59e0b" : bm.style === 2 ? "#ef4444" : "var(--accent)"}`,
                      }}>
                        <div style={{ fontSize: "14px", color: "var(--text-primary)", lineHeight: "1.6" }}>
                          {bm.markText}
                        </div>
                        {bm.chapterUid && chapterMap.has(bm.chapterUid) && (
                          <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "8px" }}>
                            — {chapterMap.get(bm.chapterUid)}
                          </div>
                        )}
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
                      <div key={r.reviewId} style={{
                        padding: "14px 16px", borderRadius: "12px", background: "var(--bg-secondary)",
                        border: "1px solid var(--border)",
                      }}>
                        {r.abstract_ && (
                          <div style={{
                            fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.5",
                            padding: "8px 12px", borderRadius: "8px", background: "var(--bg-tertiary)",
                            marginBottom: "10px", borderLeft: "2px solid var(--accent)",
                          }}>
                            {r.abstract_}
                          </div>
                        )}
                        <div style={{ fontSize: "14px", color: "var(--text-primary)", lineHeight: "1.6" }}>
                          {r.content}
                        </div>
                        <div style={{ display: "flex", gap: "12px", marginTop: "8px", fontSize: "11px", color: "var(--text-secondary)" }}>
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
                      <div key={bm.bookmarkId} style={{
                        padding: "14px 16px", borderRadius: "12px", background: "var(--bg-secondary)",
                        border: "1px solid var(--border)",
                      }}>
                        <div style={{ fontSize: "14px", color: "var(--text-primary)", lineHeight: "1.6" }}>
                          {bm.markText}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px" }}>
                          <Users size={12} style={{ color: "var(--text-secondary)" }} />
                          <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                            {bm.totalCount} 人标注
                          </span>
                          {chapterMap.has(bm.chapterUid) && (
                            <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: "8px" }}>
                              — {chapterMap.get(bm.chapterUid)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "info" && bookInfo && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {bookInfo.intro && (
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>简介</div>
                      <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.7" }}>
                        {bookInfo.intro}
                      </div>
                    </div>
                  )}
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px",
                    padding: "16px", borderRadius: "12px", background: "var(--bg-secondary)",
                  }}>
                    {bookInfo.publisher && <InfoItem label="出版社" value={bookInfo.publisher} />}
                    {bookInfo.publishTime && <InfoItem label="出版时间" value={bookInfo.publishTime} />}
                    {bookInfo.isbn && <InfoItem label="ISBN" value={bookInfo.isbn} />}
                    {bookInfo.category && <InfoItem label="分类" value={bookInfo.category} />}
                    {bookInfo.newRatingCount && <InfoItem label="评价人数" value={`${bookInfo.newRatingCount}`} />}
                    {formatWordCount(bookInfo.wordCount) && <InfoItem label="字数" value={formatWordCount(bookInfo.wordCount)!} />}
                  </div>

                  {chapters.length > 0 && (
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>
                        目录 ({chapters.length} 章)
                      </div>
                      <div style={{ maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
                        {chapters.map((ch) => (
                          <div key={ch.chapterUid} style={{
                            fontSize: "13px", color: "var(--text-secondary)", padding: "6px 10px",
                            borderRadius: "6px", background: "var(--bg-secondary)",
                          }}>
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
    <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)", fontSize: "14px" }}>
      {text}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "13px", color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

export default WereadBookDetailModal;
