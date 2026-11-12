import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import toast from "react-hot-toast";
import {
  ArrowUp,
  Brain,
  Check,
  ChevronRight,
  Copy,
  Loader2,
  MessageCircleQuestion,
  RefreshCw,
  Sparkles,
  Square,
} from "lucide-react";
import WereadMarkdown from "./WereadMarkdown";
import { warnIgnored } from "../utils/log";
import {
  onWereadAsk,
  wereadAiAsk,
  wereadAiCancel,
  wereadAiSuggestions,
  type WereadAiSuggestions,
  type WereadAskFrame,
} from "../api/weread";

/** 外部（如划线「问 AI」）投递的问题；nonce 变化即触发一次提问 */
export interface PendingQuestion {
  query: string;
  label?: string;
  nonce: number;
}

interface Props {
  bookId: string;
  bookTitle?: string;
  pending: PendingQuestion | null;
}

type TurnStatus = "waiting" | "streaming" | "done" | "error" | "cancelled";

interface Turn {
  key: number;
  askId: number | null;
  /** 气泡上方的小标签，如「全书总结」「解读划线」 */
  label?: string;
  question: string;
  intent?: string;
  text: string;
  thinking: string;
  status: TurnStatus;
  error?: string;
}

const MAX_CHARS = 1000;

/** 详情弹窗「AI 问书」：快捷提问 + 建议问题 + 自由提问；回答逐帧渲染 Markdown（每问独立，不支持多轮） */
export default function WereadAskPanel({ bookId, bookTitle, pending }: Props) {
  const [suggestions, setSuggestions] = useState<WereadAiSuggestions | null>(null);
  const [suggestError, setSuggestError] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const turnsRef = useRef<Turn[]>([]);
  const nextKey = useRef(1);
  // askId 在 invoke 返回前可能已有帧到达，先暂存
  const earlyFrames = useRef(new Map<number, WereadAskFrame>());
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastNonce = useRef<number | null>(null);

  const commit = useCallback((updater: (prev: Turn[]) => Turn[]) => {
    turnsRef.current = updater(turnsRef.current);
    setTurns(turnsRef.current);
  }, []);

  const applyFrame = useCallback(
    (frame: WereadAskFrame) => {
      const owner = turnsRef.current.find((t) => t.askId === frame.askId);
      if (!owner) {
        earlyFrames.current.set(frame.askId, frame);
        return;
      }
      if (owner.status === "cancelled") return;
      commit((prev) =>
        prev.map((t) =>
          t.askId !== frame.askId
            ? t
            : frame.error
              ? { ...t, status: "error", error: frame.error }
              : {
                  ...t,
                  text: frame.text || t.text,
                  thinking: frame.thinking || t.thinking,
                  status: frame.done ? "done" : "streaming",
                },
        ),
      );
    },
    [commit],
  );

  const loadSuggestions = useCallback(() => {
    setSuggestError("");
    wereadAiSuggestions(bookId)
      .then(setSuggestions)
      .catch((err) => setSuggestError(String(err ?? "加载失败")));
  }, [bookId]);

  useEffect(loadSuggestions, [loadSuggestions]);

  // 订阅回答事件；卸载（关弹窗 / 换书）时取消仍在生成的提问
  useEffect(() => {
    const unlisten = onWereadAsk(applyFrame);
    return () => {
      unlisten.then((fn) => fn()).catch(warnIgnored("weread_ask_unlisten"));
      for (const t of turnsRef.current) {
        if (t.askId !== null && (t.status === "waiting" || t.status === "streaming")) {
          wereadAiCancel(t.askId).catch(warnIgnored("weread_ai_cancel"));
        }
      }
    };
  }, [applyFrame]);

  const busy = turns.some((t) => t.status === "waiting" || t.status === "streaming");

  const ask = useCallback(
    async (question: string, opts: { label?: string; intent?: string } = {}) => {
      const query = question.trim();
      if (
        !query ||
        turnsRef.current.some((t) => t.status === "waiting" || t.status === "streaming")
      )
        return;
      const key = nextKey.current++;
      commit((prev) => [
        ...prev,
        {
          key,
          askId: null,
          label: opts.label,
          question: query,
          intent: opts.intent,
          text: "",
          thinking: "",
          status: "waiting",
        },
      ]);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
      try {
        const askId = await wereadAiAsk(bookId, query, opts.intent);
        commit((prev) => prev.map((t) => (t.key === key ? { ...t, askId } : t)));
        const early = earlyFrames.current.get(askId);
        if (early) {
          earlyFrames.current.delete(askId);
          applyFrame(early);
        }
      } catch (err) {
        commit((prev) =>
          prev.map((t) =>
            t.key === key ? { ...t, status: "error", error: String(err ?? "提问失败") } : t,
          ),
        );
      }
    },
    [applyFrame, bookId, commit],
  );

  // 外部投递的问题（划线「问 AI」）
  useEffect(() => {
    if (!pending || pending.nonce === lastNonce.current) return;
    lastNonce.current = pending.nonce;
    ask(pending.query, { label: pending.label });
  }, [pending, ask]);

  const stop = () => {
    const active = turnsRef.current.find((t) => t.status === "waiting" || t.status === "streaming");
    if (!active) return;
    if (active.askId !== null) wereadAiCancel(active.askId).catch(warnIgnored("weread_ai_cancel"));
    commit((prev) => prev.map((t) => (t.key === active.key ? { ...t, status: "cancelled" } : t)));
  };

  const submit = () => {
    if (busy || !input.trim()) return;
    ask(input);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  };

  const prompts = suggestions?.prompts ?? [];
  const questions = suggestions?.questions ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px", minHeight: "100%" }}>
      {turns.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "var(--radius-md)",
                background:
                  "linear-gradient(135deg, rgba(var(--accent-rgb),0.22), rgba(var(--accent-rgb),0.08))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Sparkles size={18} style={{ color: "var(--accent)" }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                向 AI 提问{bookTitle ? `《${bookTitle}》` : "这本书"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                选一个快捷提问，或在下方输入你的问题
              </div>
            </div>
          </div>

          {suggestError && !suggestions ? (
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              <span style={{ userSelect: "text" }}>建议问题加载失败：{suggestError}</span>{" "}
              <button className="btn btn-ghost btn-sm" onClick={loadSuggestions}>
                <RefreshCw size={12} /> 重试
              </button>
            </div>
          ) : !suggestions ? (
            <div style={{ display: "flex", gap: 8, color: "var(--text-muted)", fontSize: 13 }}>
              <Loader2 size={14} className="spin" /> 正在准备建议问题…
            </div>
          ) : (
            <>
              {prompts.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {prompts.map((p) => (
                    <button
                      key={p.title}
                      className="wr-ask-chip"
                      title={p.prompt}
                      onClick={() => ask(p.prompt, { label: p.title, intent: p.intent })}
                    >
                      <Sparkles size={13} />
                      {p.title}
                    </button>
                  ))}
                </div>
              )}
              {questions.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                    你可能想问
                  </div>
                  {questions.map((q) => (
                    <button key={q} className="wr-ask-question" onClick={() => ask(q)}>
                      <MessageCircleQuestion
                        size={15}
                        style={{ color: "var(--accent)", flexShrink: 0 }}
                      />
                      <span style={{ flex: 1 }}>{q}</span>
                      <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {turns.map((t) => (
        <TurnView
          key={t.key}
          turn={t}
          onRetry={() => ask(t.question, { label: t.label, intent: t.intent })}
          retryDisabled={busy}
        />
      ))}

      <div ref={endRef} />

      <div
        style={{
          position: "sticky",
          bottom: "-16px",
          marginTop: "auto",
          paddingTop: "10px",
          paddingBottom: "16px",
          background: "var(--bg-primary)",
        }}
      >
        {turns.length > 0 && prompts.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
            {prompts.map((p) => (
              <button
                key={p.title}
                className="wr-ask-chip"
                style={{ padding: "4px 10px", fontSize: 12 }}
                disabled={busy}
                onClick={() => ask(p.prompt, { label: p.title, intent: p.intent })}
              >
                {p.title}
              </button>
            ))}
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: "10px",
            padding: "10px 10px 10px 14px",
            borderRadius: "14px",
            border: "1px solid var(--border)",
            background: "var(--bg-secondary)",
          }}
        >
          <textarea
            ref={inputRef}
            className="wr-ask-input"
            rows={1}
            value={input}
            maxLength={MAX_CHARS}
            placeholder="问问这本书…（Enter 发送，Shift+Enter 换行）"
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {busy ? (
            <button
              onClick={stop}
              title="停止生成"
              style={sendButtonStyle("var(--bg-tertiary)", "var(--text-primary)")}
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim()}
              title="发送"
              style={sendButtonStyle(
                input.trim() ? "var(--accent)" : "var(--bg-tertiary)",
                input.trim() ? "#fff" : "var(--text-muted)",
              )}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "6px",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          <span>回答由微信读书 AI 生成，每次提问独立、不记得上文</span>
          {input.length > MAX_CHARS * 0.8 && (
            <span>
              {input.length}/{MAX_CHARS}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function sendButtonStyle(background: string, color: string): CSSProperties {
  return {
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: "none",
    background,
    color,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
    transition: "background var(--transition-fast)",
  };
}

function TurnView({
  turn,
  onRetry,
  retryDisabled,
}: {
  turn: Turn;
  onRetry: () => void;
  retryDisabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const generating = turn.status === "waiting" || turn.status === "streaming";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error(`复制失败：${String(err)}`);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div className="wr-ask-turn-q">
        {turn.label && (
          <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 2, fontWeight: 600 }}>
            {turn.label}
          </div>
        )}
        {turn.question}
      </div>

      <div className="wr-ask-turn-a">
        {turn.thinking && (
          <details className="wr-ask-thinking">
            <summary style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Brain size={13} />
              {generating && !turn.text ? "正在思考…" : "思考过程"}
            </summary>
            <div className="wr-ask-thinking-body">{turn.thinking}</div>
          </details>
        )}

        {turn.text ? (
          <WereadMarkdown text={turn.text} streaming={turn.status === "streaming"} />
        ) : generating ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--text-muted)",
              fontSize: 13,
            }}
          >
            <Loader2 size={14} className="spin" /> 正在思考…
          </div>
        ) : null}

        {turn.status === "error" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: turn.text ? 12 : 0,
              fontSize: 13,
              color: "#ef4444",
            }}
          >
            <span style={{ flex: 1, userSelect: "text", wordBreak: "break-all" }}>
              回答失败：{turn.error}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={onRetry} disabled={retryDisabled}>
              <RefreshCw size={12} /> 重试
            </button>
          </div>
        )}

        {(turn.status === "done" || turn.status === "cancelled") && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: turn.text ? 14 : 0,
              paddingTop: turn.text ? 10 : 0,
              borderTop: turn.text ? "1px solid var(--border)" : "none",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            {turn.status === "cancelled" && <span>已停止生成</span>}
            {turn.text && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={copy}
                style={{ marginLeft: "auto", gap: 4 }}
              >
                {copied ? <Check size={13} color="#22c55e" /> : <Copy size={13} />}
                {copied ? "已复制" : "复制回答"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
