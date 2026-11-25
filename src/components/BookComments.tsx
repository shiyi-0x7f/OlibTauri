import React from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { getBookComments } from "../api/books";
import type { BookComment } from "../api/types";

/** 折叠状态下显示的顶层评论数 */
const COLLAPSED_COUNT = 5;

interface CommentThread {
  comment: BookComment;
  replies: BookComment[];
}

/** 接口在无评论时可能返回对象而非数组 */
function toList(raw: BookComment[] | Record<string, BookComment> | undefined): BookComment[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : Object.values(raw);
}

/** 按 parent_id 组装成楼中楼；父评论不在列表中的回复按顶层显示 */
function buildThreads(list: BookComment[]): CommentThread[] {
  const ids = new Set(list.map((c) => c.id));
  const threads = new Map<number, CommentThread>();
  for (const c of list) {
    if (c.parent_id === null || !ids.has(c.parent_id)) {
      threads.set(c.id, { comment: c, replies: [] });
    }
  }
  for (const c of list) {
    if (c.parent_id !== null && threads.has(c.parent_id)) {
      threads.get(c.parent_id)?.replies.push(c);
    }
  }
  return [...threads.values()];
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  marginBottom: "8px",
  display: "flex",
  alignItems: "center",
  gap: "6px",
};

const hintStyle: React.CSSProperties = { fontSize: "12px", color: "var(--text-muted)" };

const Avatar: React.FC<{ user: BookComment["user"] }> = ({ user }) => {
  const [failed, setFailed] = React.useState(false);
  const name = user?.name || "?";
  const src = user?.avatar;
  const size = 24;
  if (src && /^https?:\/\//.test(src) && !failed) {
    return (
      <img
        src={src}
        alt={name}
        onError={() => setFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "11px",
        fontWeight: 600,
        background: "var(--bg-tertiary)",
        color: "var(--text-secondary)",
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
};

const CommentItem: React.FC<{ comment: BookComment; isReply?: boolean }> = ({
  comment,
  isReply,
}) => (
  <div style={{ display: "flex", gap: "8px", paddingLeft: isReply ? "32px" : 0 }}>
    <Avatar user={comment.user} />
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", fontSize: "12px" }}>
        <span className="truncate" style={{ fontWeight: 600, color: "var(--text-primary)" }}>
          {comment.user?.name || "匿名"}
        </span>
        {comment.date && (
          <span style={{ color: "var(--text-muted)", flexShrink: 0 }} title={comment.date}>
            {comment.date.slice(0, 10)}
          </span>
        )}
      </div>
      <p
        style={{
          fontSize: "13px",
          lineHeight: 1.6,
          color: "var(--text-secondary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          userSelect: "text",
          marginTop: "2px",
        }}
      >
        {comment.text.trim()}
      </p>
    </div>
  </div>
);

/**
 * 书籍详情页的只读评论区（Z站 /papi/comments）。
 * 调用方需传 `key={bookId}`：换书时重新挂载以重置状态。
 */
const BookComments: React.FC<{ bookId: number | string }> = ({ bookId }) => {
  const [threads, setThreads] = React.useState<CommentThread[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [disabled, setDisabled] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    getBookComments(String(bookId))
      .then((resp) => {
        if (cancelled) return;
        const list = toList(resp?.comments);
        setDisabled(Boolean(resp?.commentsDisabled));
        setTotal(list.length);
        setThreads(buildThreads(list));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setThreads([]);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const visible = threads && !expanded ? threads.slice(0, COLLAPSED_COUNT) : threads;

  return (
    <div style={{ marginBottom: "20px" }}>
      <h4 style={sectionTitleStyle}>
        <MessageSquare size={12} />
        读者评论{total > 0 && `（${total}）`}
      </h4>
      {threads === null ? (
        <div style={{ ...hintStyle, display: "flex", alignItems: "center", gap: "6px" }}>
          <Loader2 size={13} className="spinner" /> 加载中...
        </div>
      ) : error ? (
        <div style={{ ...hintStyle, userSelect: "text", wordBreak: "break-all" }}>
          获取失败：{error}
        </div>
      ) : disabled ? (
        <div style={hintStyle}>该书已关闭评论</div>
      ) : threads.length === 0 ? (
        <div style={hintStyle}>暂无评论</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {visible?.map((t) => (
            <div
              key={t.comment.id}
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              <CommentItem comment={t.comment} />
              {t.replies.map((r) => (
                <CommentItem key={r.id} comment={r} isReply />
              ))}
            </div>
          ))}
          {threads.length > COLLAPSED_COUNT && (
            <button
              className="btn btn-secondary"
              onClick={() => setExpanded((v) => !v)}
              style={{ alignSelf: "flex-start", padding: "4px 10px", fontSize: "12px" }}
            >
              {expanded ? "收起" : `展开全部 ${threads.length} 条`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default BookComments;
