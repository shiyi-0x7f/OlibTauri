import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Loader2, RefreshCw, Smartphone, CheckCircle2 } from "lucide-react";
import { wereadQrPoll, wereadQrStart, type WereadQrStatus } from "../api/weread";

interface Props {
  onClose: () => void;
  onConnected: () => void;
}

type Phase = "loading" | WereadQrStatus | "error";

/** 二维码有效期，与 weread-omni / olib-mobile 的轮询截止时间一致；服务端返回过期（402）时以服务端为准 */
const QR_TTL_MS = 5 * 60_000;

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const HINTS: Record<Phase, string> = {
  loading: "正在生成二维码…",
  waiting: "打开手机微信「扫一扫」，用摄像头对准上方二维码（截图或相册识别无效）",
  scanned: "已扫码，请在手机上点击「同意」",
  confirmed: "连接成功",
  expired: "二维码已过期",
  declined: "已在手机上取消授权",
  error: "",
};

/** 微信读书扫码连接：电脑展示二维码，手机微信扫一扫确认（微信不支持同机识别）。 */
export default function WereadQrLoginDialog({ onClose, onConnected }: Props) {
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // 每次生成新码递增；旧轮询循环发现代次变化即退出（含对话框关闭、倒计时到期）
  const generation = useRef(0);

  const start = useCallback(async () => {
    const gen = ++generation.current;
    const alive = () => generation.current === gen;
    setPhase("loading");
    setQrSrc(null);
    setError("");
    setExpiresAt(null);
    try {
      const qr = await wereadQrStart();
      if (!alive()) return;
      setQrSrc(qr.qr_image);
      setNow(Date.now());
      setExpiresAt(Date.now() + QR_TTL_MS);
      setPhase("waiting");
      let last: number | null = null;
      while (alive()) {
        const res = await wereadQrPoll(qr.uuid, last);
        if (!alive()) return;
        last = res.last;
        setPhase(res.status);
        if (res.status === "confirmed") {
          onConnected();
          return;
        }
        if (res.status === "expired" || res.status === "declined") return;
      }
    } catch (err) {
      if (!alive()) return;
      setError(String(err ?? "未知错误"));
      setPhase("error");
    }
  }, [onConnected]);

  useEffect(() => {
    const gen = generation;
    start();
    return () => {
      // 作废进行中的轮询循环（ref 是计数器而非 DOM 节点，取最新值递增正是本意）
      gen.current++;
    };
  }, [start]);

  const counting = expiresAt !== null && (phase === "waiting" || phase === "scanned");

  // 倒计时：每秒刷新；到期即作废轮询循环并转为过期
  useEffect(() => {
    if (!counting || expiresAt === null) return;
    const deadline = expiresAt;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline) {
        generation.current++;
        setPhase("expired");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [counting, expiresAt]);

  const remaining = expiresAt === null ? 0 : expiresAt - now;
  const canRetry = phase === "expired" || phase === "declined" || phase === "error";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: 400, maxWidth: 440 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "var(--radius-md)",
              background:
                "linear-gradient(135deg, rgba(var(--accent-rgb),0.2), rgba(var(--accent-rgb),0.1))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BookOpen size={20} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <div className="modal-title" style={{ margin: 0, fontSize: 17 }}>
              连接微信读书
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              用手机微信扫码授权，Olib 将读取你的书架、笔记与阅读统计
            </div>
          </div>
        </div>

        <div style={{ textAlign: "center", marginBottom: 16 }}>
          {phase === "error" ? (
            <p
              style={{
                fontSize: 13,
                color: "#ef4444",
                padding: "32px 8px",
                userSelect: "text",
                wordBreak: "break-all",
              }}
            >
              连接失败：{error}
            </p>
          ) : qrSrc ? (
            <div
              style={{
                position: "relative",
                background: "white",
                borderRadius: "var(--radius-lg)",
                padding: 16,
                display: "inline-block",
              }}
            >
              <img
                src={qrSrc}
                alt="微信读书登录二维码"
                style={{
                  width: 200,
                  height: 200,
                  display: "block",
                  opacity: phase === "waiting" ? 1 : 0.15,
                }}
              />
              {phase !== "waiting" && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {phase === "scanned" && <Smartphone size={44} color="var(--accent)" />}
                  {phase === "confirmed" && <CheckCircle2 size={44} color="#22c55e" />}
                  {(phase === "expired" || phase === "declined") && (
                    <button className="btn btn-primary btn-sm" onClick={start}>
                      <RefreshCw size={14} /> 刷新二维码
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: "80px 0" }}>
              <Loader2 size={28} className="spin" style={{ color: "var(--text-muted)" }} />
            </div>
          )}
          {phase !== "error" && (
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 14 }}>
              {HINTS[phase]}
            </p>
          )}
          {counting && (
            <p
              style={{
                fontSize: 12,
                marginTop: 4,
                color: remaining <= 30_000 ? "#ef4444" : "var(--text-muted)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              二维码将在 {formatRemaining(remaining)} 后过期
            </p>
          )}
        </div>

        <div className="modal-actions">
          {phase === "error" && canRetry && (
            <button className="btn btn-primary" onClick={start}>
              重试
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>
            {phase === "confirmed" ? "完成" : "取消"}
          </button>
        </div>
      </div>
    </div>
  );
}
