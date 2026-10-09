import React from "react";
import { ArrowUpCircle, Download, ExternalLink, Github, Globe } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { UpdateInfo } from "../api/config";
import { warnIgnored } from "../utils/log";

/** 官网项目页：网盘链接由 PanSync 同步到这里，始终作为兜底渠道 */
const OFFICIAL_URL = "https://www.11xy.cn/projects/olib-%E7%94%B5%E8%84%91%E7%AB%AF";

interface UpdateDialogProps {
  info: UpdateInfo;
  /** 强制更新时不传：对话框不可关闭 */
  onClose?: () => void;
}

/** 更新对话框：列出 Release 清单配置的下载渠道（网盘等）+ 官网 + GitHub，用户自选 */
const UpdateDialog: React.FC<UpdateDialogProps> = ({ info, onClose }) => {
  const forced = info.force_update || !onClose;

  React.useEffect(() => {
    if (forced) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [forced, onClose]);

  const open = (url: string) => {
    openUrl(url).catch(warnIgnored("open_update_link"));
  };

  const channels = [
    ...info.links.map((l) => ({ name: l.name, url: l.url, icon: Download })),
    { name: "官网下载", url: OFFICIAL_URL, icon: Globe },
    ...(info.release_url ? [{ name: "GitHub", url: info.release_url, icon: Github }] : []),
  ];

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (!forced && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="modal" style={{ maxWidth: "440px", width: "90vw", padding: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              background: "rgba(var(--accent-rgb), 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <ArrowUpCircle size={24} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <h3 style={{ fontSize: "17px", fontWeight: 700, color: "var(--text-primary)" }}>
              {forced ? "需要更新后才能继续使用" : `发现新版本 v${info.latest_version}`}
            </h3>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
              当前版本 v{info.current_version}
              {forced && ` · 最新版本 v${info.latest_version}`}
            </div>
          </div>
        </div>

        {forced && (
          <p
            style={{
              fontSize: "13px",
              color: "var(--text-secondary)",
              lineHeight: 1.6,
              marginBottom: "14px",
            }}
          >
            当前版本已停止支持，请下载新版本安装后再使用。
          </p>
        )}

        {info.notes && (
          <div
            style={{
              maxHeight: "180px",
              overflowY: "auto",
              padding: "12px 14px",
              background: "var(--bg-tertiary)",
              borderRadius: "var(--radius-md)",
              fontSize: "12.5px",
              lineHeight: 1.7,
              color: "var(--text-secondary)",
              whiteSpace: "pre-wrap",
              marginBottom: "18px",
            }}
          >
            {info.notes}
          </div>
        )}

        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>
          选择下载渠道
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {channels.map(({ name, url, icon: Icon }, i) => (
            <button
              key={`${name}-${url}`}
              className={i === 0 ? "btn btn-primary w-full" : "btn btn-secondary w-full"}
              onClick={() => open(url)}
              style={{ padding: "10px 14px", fontSize: "13px", justifyContent: "space-between" }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                <Icon size={16} />
                {name}
              </span>
              <ExternalLink size={14} style={{ opacity: 0.7 }} />
            </button>
          ))}
          {!forced && (
            <button
              className="btn btn-ghost w-full"
              onClick={onClose}
              style={{ padding: "8px", fontSize: "13px" }}
            >
              稍后再说
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdateDialog;
