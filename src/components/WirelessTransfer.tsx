import { useState, useEffect } from "react";
import { Wifi, WifiOff, Copy, Check, Loader2, BookOpen } from "lucide-react";
import { getLanStatus, startLanServer, stopLanServer, type LanStatus } from "../api/lan";

export default function WirelessTransfer({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [opdsCopied, setOpdsCopied] = useState(false);
  const [port] = useState(8765);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const s = await getLanStatus();
      setStatus(s);
    } catch (err) {
      console.error("Failed to get LAN status:", err);
    }
  };

  const handleStart = async () => {
    setLoading(true);
    try {
      const s = await startLanServer(port);
      setStatus(s);
    } catch (err) {
      console.error("Failed to start LAN server:", err);
    }
    setLoading(false);
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await stopLanServer();
      setStatus({ running: false, url: "", qr_base64: "", port: 0, wifi_name: "", opds_url: "" });
    } catch (err) {
      console.error("Failed to stop LAN server:", err);
    }
    setLoading(false);
  };

  const handleCopy = () => {
    if (status?.url) {
      navigator.clipboard.writeText(status.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyOpds = () => {
    if (status?.opds_url) {
      navigator.clipboard.writeText(status.opds_url);
      setOpdsCopied(true);
      setTimeout(() => setOpdsCopied(false), 2000);
    }
  };

  const isRunning = status?.running ?? false;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal wireless-transfer-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: 420, maxWidth: 460 }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "var(--radius-md)",
              background: isRunning
                ? "linear-gradient(135deg, rgba(34,197,94,0.2), rgba(34,197,94,0.1))"
                : "linear-gradient(135deg, rgba(var(--accent-rgb),0.2), rgba(var(--accent-rgb),0.1))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isRunning ? (
              <Wifi size={20} color="#22c55e" />
            ) : (
              <WifiOff size={20} style={{ color: "var(--accent)" }} />
            )}
          </div>
          <div>
            <div className="modal-title" style={{ margin: 0, fontSize: 17 }}>
              无线传书
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {isRunning ? (
                <>
                  服务运行中{status?.wifi_name && <> · 📶 {status.wifi_name}</>} ·
                  手机扫码即可下载书籍
                </>
              ) : (
                <>
                  开启后，同一局域网的设备可以浏览和下载书架中的书籍
                  {status?.wifi_name && <> · 当前网络: {status.wifi_name}</>}
                </>
              )}
            </div>
          </div>
        </div>

        {/* QR Code & URL (when running) */}
        {isRunning && status && (
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            {/* QR Code */}
            <div
              style={{
                background: "white",
                borderRadius: "var(--radius-lg)",
                padding: 16,
                display: "inline-block",
                marginBottom: 14,
              }}
            >
              <img
                src={status.qr_base64}
                alt="QR Code"
                style={{ width: 180, height: 180, display: "block" }}
              />
            </div>

            {/* URL */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                justifyContent: "center",
                padding: "10px 16px",
                background: "var(--bg-tertiary)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--accent-light)",
                  fontFamily: "monospace",
                }}
              >
                {status.url}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleCopy}
                style={{ padding: "4px 8px" }}
                title="复制链接"
              >
                {copied ? <Check size={14} color="#22c55e" /> : <Copy size={14} />}
              </button>
            </div>

            {/* OPDS URL */}
            {status.opds_url && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  justifyContent: "center",
                  padding: "8px 16px",
                  marginTop: 8,
                  background: "var(--bg-tertiary)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                }}
              >
                <BookOpen size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    fontFamily: "monospace",
                  }}
                >
                  {status.opds_url}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleCopyOpds}
                  style={{ padding: "4px 8px" }}
                  title="复制 OPDS 目录地址"
                >
                  {opdsCopied ? <Check size={14} color="#22c55e" /> : <Copy size={14} />}
                </button>
              </div>
            )}

            {/* Tip */}
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
              请确保手机与电脑连接在同一个 Wi-Fi 网络
              <br />
              OPDS 地址可添加到 KOReader、静读天下等阅读 App 直接浏览书库
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="modal-actions" style={{ marginTop: isRunning ? 0 : 24 }}>
          <button className="btn btn-secondary" onClick={onClose}>
            关闭
          </button>
          {isRunning ? (
            <button className="btn btn-danger" onClick={handleStop} disabled={loading}>
              {loading ? <Loader2 size={14} className="spin" /> : <WifiOff size={14} />}
              停止服务
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleStart} disabled={loading}>
              {loading ? <Loader2 size={14} className="spin" /> : <Wifi size={14} />}
              开启传书
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
