import { Check } from "lucide-react";
import { THEME_COLORS } from "../../constants/themes";
import { useTheme } from "../../hooks/useTheme";
import type { AppConfig } from "./types";

interface AppearanceSectionProps {
    config: AppConfig;
    update: (key: keyof AppConfig, value: any) => void;
}

export default function AppearanceSection({ config: _config, update }: AppearanceSectionProps) {
    const { theme, primaryColor, updateTheme, updatePrimaryColor } = useTheme();

    return (
        <div className="card settings-grid-full">
            <div className="settings-group">
                <div className="settings-group-title">外观</div>

                <div className="settings-item">
                    <div className="settings-item-info">
                        <div className="settings-item-title">主题模式</div>
                        <div className="settings-item-desc">选择深色或浅色主题</div>
                    </div>
                    <select
                        className="select"
                        value={theme}
                        onChange={(e) => {
                            const newTheme = e.target.value as "light" | "dark" | "system" | "glass" | "dynamic";
                            updateTheme(newTheme);
                            update("theme", newTheme);
                        }}
                    >
                        <option value="dark">深色</option>
                        <option value="light">浅色</option>
                        <option value="system">跟随系统</option>
                        <option value="glass">毛玻璃 (Mica)</option>
                        <option value="dynamic">动态光效</option>
                    </select>
                </div>

                <div className="settings-item">
                    <div className="settings-item-info">
                        <div className="settings-item-title">主题颜色</div>
                        <div className="settings-item-desc">选择你喜欢的主题颜色</div>
                    </div>
                    <div style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        flexWrap: "wrap",
                    }}>
                        {THEME_COLORS.map((themeColor) => (
                            <div
                                key={themeColor.id}
                                title={themeColor.name}
                                onClick={() => {
                                    updatePrimaryColor(themeColor.color);
                                    update("primary_color", themeColor.color);
                                }}
                                style={{
                                    cursor: "pointer",
                                    width: "28px",
                                    height: "28px",
                                    borderRadius: "50%",
                                    background: `linear-gradient(135deg, ${themeColor.color}, ${themeColor.light})`,
                                    border: primaryColor === themeColor.color
                                        ? `2.5px solid ${themeColor.color}`
                                        : "2.5px solid transparent",
                                    outline: primaryColor === themeColor.color
                                        ? "2px solid var(--bg-primary)"
                                        : "none",
                                    outlineOffset: "-4px",
                                    boxShadow: primaryColor === themeColor.color
                                        ? `0 0 0 2px ${themeColor.color}`
                                        : "none",
                                    transition: "all var(--transition-fast)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}
                                className="color-option"
                            >
                                {primaryColor === themeColor.color && (
                                    <Check size={14} color="white" strokeWidth={3} />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
