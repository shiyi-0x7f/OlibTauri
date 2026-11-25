import { useEffect, useState } from "react";
import { getConfig, setConfig } from "../api/config";
import { hexToRgb, resolveThemeColor } from "../constants/themes";

// 「毛玻璃 (Mica)」（依赖系统窗口特效，Win10 拖动卡顿）与「动态光效」（几乎看不出效果）已移除；
// 旧配置值 "glass" / "dynamic" 读取时回落为 dark
export type ThemeMode = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [primaryColor, setPrimaryColor] = useState("#009faa");

  // Load theme from backend config
  useEffect(() => {
    loadTheme();
  }, []);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (themeMode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system", primaryColor);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [themeMode, primaryColor]);

  const loadTheme = async () => {
    try {
      const config = await getConfig();
      const valid: ThemeMode[] = ["light", "dark", "system"];
      const mode = valid.includes(config.theme as ThemeMode) ? (config.theme as ThemeMode) : "dark";
      setThemeMode(mode);
      setPrimaryColor(config.primary_color || "#009faa");
      applyTheme(mode, config.primary_color || "#009faa");
    } catch (err) {
      console.error("Failed to load theme:", err);
    }
  };

  const applyTheme = (mode: ThemeMode, color: string) => {
    const root = document.documentElement;

    // 「跟随系统」解析为当前系统的 light / dark
    root.setAttribute("data-theme", mode === "system" ? getSystemTheme() : mode);

    // 预设色或调色盘自定义色均可（自定义色由 resolveThemeColor 推算色板）
    const themeColor = resolveThemeColor(color);
    const rgb = hexToRgb(themeColor.color);

    // Set CSS variables for the selected color
    root.style.setProperty("--accent", themeColor.color);
    root.style.setProperty("--accent-light", themeColor.light);
    root.style.setProperty("--accent-dark", themeColor.dark);
    root.style.setProperty("--accent-glow", themeColor.glow);
    root.style.setProperty("--accent-rgb", rgb);
  };

  const updateTheme = async (newMode: ThemeMode) => {
    setThemeMode(newMode);
    applyTheme(newMode, primaryColor);

    // Save to backend
    try {
      const config = await getConfig();
      await setConfig({ ...config, theme: newMode });
    } catch (err) {
      console.error("Failed to save theme:", err);
    }
  };

  const updatePrimaryColor = async (newColor: string) => {
    setPrimaryColor(newColor);
    applyTheme(themeMode, newColor);

    // Save to backend
    try {
      const config = await getConfig();
      await setConfig({ ...config, primary_color: newColor });
    } catch (err) {
      console.error("Failed to save color:", err);
    }
  };

  return {
    theme: themeMode,
    primaryColor,
    updateTheme,
    updatePrimaryColor,
  };
}
