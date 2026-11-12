import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { History, MessageSquare, Smartphone, Download, type LucideIcon } from "lucide-react";
import WirelessTransfer from "../../components/WirelessTransfer";
import { getLanStatus, MOBILE_APP_URL } from "../../api/lan";
import { warnIgnored } from "../../utils/log";

interface Action {
  key: string;
  icon: LucideIcon;
  label: string;
  desc: string;
  /** 卡片主题色，对应 quick-actions.css 的 data-tint */
  tint: "accent" | "violet" | "amber" | "rose";
  onClick: () => void;
  /** 显示「运行中」呼吸绿点 */
  active?: boolean;
}

/** 首页快捷功能：把藏得较深的功能提到首页一键直达 */
export default function QuickActions() {
  const navigate = useNavigate();
  const [showWireless, setShowWireless] = useState(false);
  const [lanRunning, setLanRunning] = useState(false);

  const refreshLan = useCallback(() => {
    getLanStatus()
      .then((s) => setLanRunning(s.running))
      .catch(warnIgnored("get_lan_status"));
  }, []);

  useEffect(() => {
    refreshLan();
  }, [refreshLan]);

  const actions: Action[] = [
    {
      key: "mobile-link",
      icon: Smartphone,
      label: "手机联动",
      desc: lanRunning ? "传书中 · 点击查看二维码" : "扫码互传书籍与书单",
      tint: "accent",
      onClick: () => setShowWireless(true),
      active: lanRunning,
    },
    {
      key: "mobile-app",
      icon: Download,
      label: "下载手机版",
      desc: "随身带上你的书库",
      tint: "violet",
      onClick: () => openUrl(MOBILE_APP_URL).catch(warnIgnored("open_mobile_app_url")),
    },
    {
      key: "history",
      icon: History,
      label: "下载历史",
      desc: "找回下载过的书",
      tint: "rose",
      onClick: () => navigate("/history"),
    },
    {
      key: "feedback",
      icon: MessageSquare,
      label: "意见反馈",
      desc: "遇到问题或有想法",
      tint: "amber",
      onClick: () => navigate("/feedback"),
    },
  ];

  return (
    <>
      <nav className="quick-actions" aria-label="快捷功能">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className="quick-action"
            data-tint={a.tint}
            onClick={a.onClick}
          >
            <span className="quick-action-icon">
              <a.icon size={19} strokeWidth={2} />
            </span>
            <span className="quick-action-text">
              <span className="quick-action-title">{a.label}</span>
              <span className="quick-action-desc">{a.desc}</span>
            </span>
            {a.active && <span className="quick-action-live" aria-label="传书中" />}
          </button>
        ))}
      </nav>

      {showWireless && (
        <WirelessTransfer
          onClose={() => {
            setShowWireless(false);
            refreshLan();
          }}
        />
      )}
    </>
  );
}
