import { useState, useEffect } from "react";
import { Wifi, WifiOff, Copy, Check, Loader2, BookOpen, Smartphone } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import toast from "react-hot-toast";
import {
  getLanStatus,
  startLanServer,
  stopLanServer,
  MOBILE_APP_URL,
  type LanStatus,
} from "../api/lan";
import { warnIgnored } from "../utils/log";

export default function WirelessTransfer({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [opdsCopied, setOpdsCopied] = useState(false);

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
      // 不传端口：后端沿用上次的端口，手机记住的地址才不会失效
      const s = await startLanServer(null);
      setStatus(s);
    } catch (err) {
      console.error("Failed to start LAN server:", err);
      toast.error(`开启无线传书失败：${String(err)}`, { duration: 6000 });
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
      <div className="modal wireless-transfer-modal" onClick={(e) => e.stopPropagation()}>
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
              <img src={status.qr_base64} alt="QR Code" className="wt-qr" />
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
              <br />
              服务无需密码，请仅在家庭 / 办公室等可信网络中使用；保持开启时下次启动会自动开启
            </p>
          </div>
        )}

        {/* 手机版下载 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            marginBottom: 16,
            background: "var(--bg-tertiary)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
          }}
        >
          <Smartphone size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12, color: "var(--text-secondary)" }}>
            装上 Olib 手机版，扫码配对一次即可随时互传书籍和书单
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => openUrl(MOBILE_APP_URL).catch(warnIgnored("open_mobile_app_url"))}
          >
            下载手机版
          </button>
        </div>

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
