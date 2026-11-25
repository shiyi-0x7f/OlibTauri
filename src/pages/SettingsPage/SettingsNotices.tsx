/** 设置页置顶声明：第三方客户端、免费非盈利（原位于「关于」底部） */
export default function SettingsNotices() {
  return (
    <div
      className="settings-grid-full"
      style={{ display: "flex", flexDirection: "column", gap: "10px" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 14px",
          borderRadius: "var(--radius-md)",
          background: "rgba(234, 179, 8, 0.06)",
          borderLeft: "3px solid #eab308",
        }}
      >
        <span style={{ fontSize: "16px", flexShrink: 0 }}>⚠️</span>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "#eab308",
            lineHeight: 1.5,
          }}
        >
          本软件为第三方客户端，与 Z站官方无任何关联
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 14px",
          borderRadius: "var(--radius-md)",
          background: "rgba(59, 130, 246, 0.06)",
          borderLeft: "3px solid #3b82f6",
        }}
      >
        <span style={{ fontSize: "16px", flexShrink: 0 }}>🚫</span>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "#60a5fa",
            lineHeight: 1.5,
          }}
        >
          本软件完全免费、非盈利，不接受任何广告与商业合作
        </span>
      </div>
    </div>
  );
}
