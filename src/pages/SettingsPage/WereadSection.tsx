import { useState } from "react";
import { BookOpen, Key, HelpCircle, Trash2, Check } from "lucide-react";
import type { AppConfig } from "./types";

interface WereadSectionProps {
  config: AppConfig;
  update: (key: keyof AppConfig, value: any) => void;
}

export default function WereadSection({ config, update }: WereadSectionProps) {
  const [showInput, setShowInput] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [saved, setSaved] = useState(false);

  const isConfigured = config.weread_api_key && config.weread_api_key.length > 0;
  const maskedKey = isConfigured
    ? config.weread_api_key.substring(0, 8) + "****"
    : "";

  const handleSave = () => {
    const trimmed = inputValue.trim();
    if (trimmed) {
      update("weread_api_key", trimmed);
      setShowInput(false);
      setInputValue("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleClear = () => {
    if (confirm("确定要清除微信读书 API Key 吗？")) {
      update("weread_api_key", "");
    }
  };

  return (
    <div className="card settings-grid-full">
      <div className="settings-group">
        <div className="settings-group-title">
          <BookOpen size={16} style={{ marginRight: "6px", verticalAlign: "-2px" }} />
          微信读书
        </div>

        {/* API Key Status */}
        <div className="settings-item" style={{ cursor: "pointer" }} onClick={() => { setShowInput(true); setInputValue(config.weread_api_key || ""); }}>
          <div className="settings-item-info">
            <div className="settings-item-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Key size={14} />
              API Key
              {saved && <Check size={14} style={{ color: "#22c55e" }} />}
            </div>
            <div className="settings-item-desc">
              {isConfigured ? (
                <span style={{ color: "#22c55e" }}>{maskedKey}</span>
              ) : (
                "未配置，点击设置 API Key"
              )}
            </div>
          </div>
          {isConfigured && (
            <button
              onClick={(e) => { e.stopPropagation(); handleClear(); }}
              style={{
                padding: "6px 8px", borderRadius: "8px", border: "none",
                background: "rgba(239,68,68,0.1)", color: "#ef4444", cursor: "pointer",
              }}
              title="清除 API Key"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>

        {/* Input Dialog */}
        {showInput && (
          <div style={{ padding: "0 16px 16px" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setShowInput(false); }}
                placeholder="wrk-xxxxxxxxxx"
                autoFocus
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: "8px",
                  border: "1px solid var(--border)", background: "var(--bg-primary)",
                  color: "var(--text-primary)", fontSize: "13px", fontFamily: "monospace",
                  outline: "none",
                }}
              />
              <button
                onClick={handleSave}
                style={{
                  padding: "8px 16px", borderRadius: "8px", border: "none",
                  background: "var(--accent)", color: "#fff", cursor: "pointer",
                  fontSize: "13px", fontWeight: 600,
                }}
              >
                保存
              </button>
              <button
                onClick={() => setShowInput(false)}
                style={{
                  padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--border)",
                  background: "transparent", color: "var(--text-secondary)", cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* Help */}
        <div className="settings-item">
          <div className="settings-item-info">
            <div className="settings-item-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <HelpCircle size={14} />
              如何获取 API Key？
            </div>
            <div className="settings-item-desc">
              访问 OpenWeRead 平台注册账号，绑定微信读书后即可获得 API Key
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
