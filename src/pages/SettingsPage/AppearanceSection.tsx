import { useEffect, useRef } from "react";
import { THEME_COLORS } from "../../constants/themes";
import { useTheme, type ThemeMode } from "../../hooks/useTheme";
import type { AppConfig } from "./types";

interface AppearanceSectionProps {
  config: AppConfig;
  update: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}

/** 调色盘拖动时连续触发，延迟应用并只落盘最后一次 */
const PICKER_DEBOUNCE_MS = 150;

export default function AppearanceSection({ config: _config, update }: AppearanceSectionProps) {
  const { theme, primaryColor, updateTheme, updatePrimaryColor } = useTheme();
  const pickerTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(pickerTimer.current), []);

  const presetId = THEME_COLORS.find((c) => c.color === primaryColor.toLowerCase())?.id ?? "custom";

  const applyColor = (color: string) => {
    updatePrimaryColor(color);
    update("primary_color", color);
  };

  const applyColorDebounced = (color: string) => {
    window.clearTimeout(pickerTimer.current);
    pickerTimer.current = window.setTimeout(() => applyColor(color), PICKER_DEBOUNCE_MS);
  };

  return (
    <div className="card">
      <div className="settings-group">
        <div className="settings-group-title">外观</div>

        <div className="settings-item">
          <div className="settings-item-info">
            <div className="settings-item-title">主题模式</div>
          </div>
          <select
            className="select"
            value={theme}
            onChange={(e) => {
              const newTheme = e.target.value as ThemeMode;
              updateTheme(newTheme);
              update("theme", newTheme);
            }}
          >
            <option value="dark">深色</option>
            <option value="light">浅色</option>
            <option value="system">跟随系统</option>
          </select>
        </div>

        <div className="settings-item">
          <div className="settings-item-info">
            <div className="settings-item-title">主题颜色</div>
          </div>
          {/* 预设下拉 + 调色盘：比一排色块窄，不挤压标题 */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
            <select
              className="select"
              value={presetId}
              onChange={(e) => {
                const preset = THEME_COLORS.find((c) => c.id === e.target.value);
                if (preset) applyColor(preset.color);
              }}
            >
              {THEME_COLORS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {presetId === "custom" && <option value="custom">自定义</option>}
            </select>
            <input
              type="color"
              className="theme-color-picker"
              title="调色盘：自定义主题颜色"
              aria-label="自定义主题颜色"
              value={primaryColor}
              onChange={(e) => applyColorDebounced(e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
