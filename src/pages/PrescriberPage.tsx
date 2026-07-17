import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { Wand2, Loader2, Search, BookOpen, RefreshCw, Sparkles } from "lucide-react";

// ── 类型（对齐 prescriber_commands.rs 返回）──
interface ReadingTip {
  book_name: string;
  author: string;
  reason: string;
  category: string;
  from_ai: boolean;
}
interface ReadingBag {
  diagnosis: string;
  tips: ReadingTip[];
}

interface Theme {
  id: string;
  emoji: string;
  label: string;
}
const THEMES: Theme[] = [
  { id: "relax", emoji: "😮‍💨", label: "工作压力大，想放松" },
  { id: "direction", emoji: "🤔", label: "感到迷茫，想找方向" },
  { id: "learn", emoji: "📈", label: "想系统学习某个领域" },
  { id: "bedtime", emoji: "💤", label: "睡前想读点轻松的" },
  { id: "heal", emoji: "💔", label: "情感低落，需要治愈" },
  { id: "thinking", emoji: "🎯", label: "想提升认知和思维" },
];

// 卡牌配色（按序循环，营造"不同稀有度"感）
const CARD_HUES = ["#22c55e", "#6366f1", "#f59e0b", "#ec4899", "#06b6d4", "#a855f7"];

const QUOTA_PHRASES = [
  "书籍是人类进步的阶梯，今天先登到这里，明天再来登一级。",
  "今日的锦囊已尽，好书值得等待，明天再会。",
  "AI 也需要歇口气，明日再为你寻书。",
];
const pickPhrase = (i: number) => QUOTA_PHRASES[i % QUOTA_PHRASES.length];

const LOADING_LINES = [
  "正在翻阅书海……",
  "为你斟酌合适的书……",
  "把心事交给书页……",
  "马上就好，好书值得等待……",
];

export default function PrescriberPage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [bag, setBag] = useState<ReadingBag | null>(null);
  const [drawId, setDrawId] = useState(0); // 每次寻书自增，触发卡牌重新翻开
  const [loadingLine, setLoadingLine] = useState(LOADING_LINES[0]);

  // 微信公众号扫码登录弹层
  const [showLogin, setShowLogin] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrExpired, setQrExpired] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const sceneId = useRef<string | null>(null);
  const pendingDiagnose = useRef<{ input: string; inputType: string } | null>(null);


  useEffect(() => {
    if (!loading) return;
    let i = 0;
    const t = window.setInterval(() => {
      i = (i + 1) % LOADING_LINES.length;
      setLoadingLine(LOADING_LINES[i]);
    }, 2500);
    return () => window.clearInterval(t);
  }, [loading]);

  const stopPolling = () => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };
  useEffect(() => () => stopPolling(), []);

  // ── 寻书 ──
  const diagnose = async (text: string, inputType: string) => {
    const q = text.trim();
    if (!q) {
      toast.error("说说你最近的状态或想读什么吧");
      return;
    }
    setLoading(true);
    setBag(null);
    try {
      const result = await invoke<ReadingBag>("prescriber_diagnose", {
        input: q,
        inputType,
        language: "zh",
      });
      setBag(result);
      setDrawId((n) => n + 1);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("NEED_LOGIN")) {
        pendingDiagnose.current = { input: q, inputType };
        openLogin();
      } else if (msg.includes("QUOTA_AI_USER") || msg.includes("QUOTA_AI_GLOBAL")) {
        toast(pickPhrase(q.length), { icon: "📖", duration: 5000 });
      } else {
        toast.error(msg.replace(/^Error:\s*/, ""));
      }
    } finally {
      setLoading(false);
    }
  };

  // ── 微信公众号扫码登录 ──
  const openLogin = async () => {
    setShowLogin(true);
    setQrExpired(false);
    setQrUrl(null);
    sceneId.current = null;
    stopPolling();
    try {
      const qr = await invoke<{ qr_url: string; scene_id: string; expire_seconds: number }>(
        "prescriber_start_login",
      );
      setQrUrl(qr.qr_url);
      sceneId.current = qr.scene_id;
      pollTimer.current = window.setInterval(pollLogin, 2000);
    } catch (e) {
      toast.error("获取二维码失败：" + String(e).replace(/^Error:\s*/, ""));
    }
  };

  const pollLogin = async () => {
    if (!sceneId.current) return;
    try {
      const status = await invoke<string>("prescriber_poll_login", {
        sceneId: sceneId.current,
      });
      if (status === "authorized") {
        stopPolling();
        setShowLogin(false);
        toast.success("登录成功");
        const pending = pendingDiagnose.current;
        pendingDiagnose.current = null;
        if (pending) diagnose(pending.input, pending.inputType);
      } else if (status === "expired") {
        stopPolling();
        setQrExpired(true);
      }
    } catch (e) {
      stopPolling();
      toast.error("登录状态查询失败：" + String(e).replace(/^Error:\s*/, ""));
    }
  };

  // ── 点击书目 → 跳转搜索 ──
  const findInLibrary = (bookName: string) => {
    navigate("/");
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("olib:palette-search", { detail: bookName }));
    }, 150);
  };

  return (
    <div className="page-container">
      <div className="prescriber">
        <div className="page-header">
          <div className="prescriber-title-row">
            <motion.span
              className="prescriber-hero-icon"
              animate={{ y: [0, -4, 0] }}
              transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
            >
              <Wand2 size={20} />
            </motion.span>
            <h1 className="page-title" style={{ margin: 0 }}>
              AI 寻书
            </h1>
          </div>
          <p className="page-subtitle">说说你的状态或想读什么，抽出三五本为你而选的书。</p>
        </div>

        {/* 主题快选 */}
        <div className="prescriber-themes">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className="prescriber-theme"
              onClick={() => diagnose(t.id, "theme")}
              disabled={loading}
            >
              <span className="prescriber-theme-emoji">{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* 自由输入 */}
        <div className="prescriber-search-row">
          <input
            className="prescriber-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && diagnose(input, "free")}
            placeholder="例如：想找几本关于时间管理的入门书"
            disabled={loading}
          />
          <button className="btn btn-primary" onClick={() => diagnose(input, "free")} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <Wand2 size={16} />}
            开始寻书
          </button>
        </div>

        {/* 加载 */}
        {loading && (
          <div className="prescriber-loading">
            <Loader2 size={28} className="spin" />
            <div>{loadingLine}</div>
          </div>
        )}

        {/* 结果 */}
        {!loading && bag && (
          <div>
            {bag.diagnosis && (
              <motion.div
                className="prescriber-diagnosis"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                {bag.diagnosis}
              </motion.div>
            )}
            <div className="prescriber-cards" key={drawId}>
              {bag.tips.map((tip, i) => {
                const hue = CARD_HUES[i % CARD_HUES.length];
                return (
                  <div className="prescriber-card-wrap" key={i}>
                    <motion.div
                      className="prescriber-card"
                      initial={{ rotateY: 180, opacity: 0, y: 28 }}
                      animate={{ rotateY: 0, opacity: 1, y: 0 }}
                      transition={{
                        delay: 0.12 + i * 0.13,
                        type: "spring",
                        stiffness: 55,
                        damping: 13,
                      }}
                      whileHover={{ y: -8, scale: 1.035 }}
                    >
                      {/* 卡面 */}
                      <div className="prescriber-card-face prescriber-card-front">
                        <div
                          className="prescriber-card-bar"
                          style={{ background: `linear-gradient(90deg, ${hue}, ${hue}99)` }}
                        />
                        {tip.category && (
                          <span
                            className="prescriber-card-cat"
                            style={{ background: `${hue}22`, color: hue }}
                          >
                            {tip.category}
                          </span>
                        )}
                        <div className="prescriber-card-title">{tip.book_name}</div>
                        <div className="prescriber-card-author">{tip.author || "佚名"}</div>
                        <div className="prescriber-card-reason">{tip.reason}</div>
                        <button
                          className="btn btn-secondary btn-sm prescriber-card-btn"
                          onClick={() => findInLibrary(tip.book_name)}
                        >
                          <Search size={13} /> 去书库找
                        </button>
                      </div>
                      {/* 卡背 */}
                      <div className="prescriber-card-face prescriber-card-back">
                        <div className="prescriber-card-back-icon">
                          <Sparkles size={26} />
                        </div>
                        <div className="prescriber-card-back-label">AI 推荐</div>
                      </div>
                    </motion.div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 空态 */}
        {!loading && !bag && (
          <div className="empty-state">
            <BookOpen className="empty-state-icon" />
            <div className="empty-state-text">选一个主题，或输入你的需求</div>
            <div className="empty-state-hint">AI 会为你抽出几本合适的书</div>
          </div>
        )}
      </div>

      {/* 微信公众号扫码登录弹层 */}
      {showLogin && (
        <div
          className="prescriber-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              stopPolling();
              setShowLogin(false);
            }
          }}
        >
          <motion.div
            className="prescriber-modal"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
          >
            <div className="prescriber-modal-title">微信扫码登录</div>
            <div className="prescriber-modal-sub">AI 寻书需登录后使用，请用微信扫码</div>
            <div className="prescriber-qr">
              {qrUrl ? (
                <img src={qrUrl} alt="二维码" width={200} height={200} />
              ) : (
                <Loader2 size={24} className="spin" color="#888" />
              )}
              {qrExpired && (
                <div className="prescriber-qr-mask">
                  二维码已过期
                  <button className="btn btn-primary btn-sm" onClick={openLogin}>
                    <RefreshCw size={12} /> 刷新
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
