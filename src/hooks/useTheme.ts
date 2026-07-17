import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getThemeColor, hexToRgb } from "../constants/themes";

type ThemeMode = "light" | "dark" | "system" | "glass" | "dynamic";

interface AppConfig {
  theme: string;
  primary_color: string;
  [key: string]: any;
}

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
      const config: AppConfig = await invoke("get_config");
      const valid: ThemeMode[] = ["light", "dark", "system", "glass", "dynamic"];
      const mode = valid.includes(config.theme as ThemeMode)
        ? (config.theme as ThemeMode)
        : "dark";
      setThemeMode(mode);
      setPrimaryColor(config.primary_color || "#009faa");
      applyTheme(mode, config.primary_color || "#009faa");
    } catch (err) {
      console.error("Failed to load theme:", err);
    }
  };

  const applyTheme = (mode: ThemeMode, color: string) => {
    const root = document.documentElement;

    // Determine the base light/dark for CSS variables
    let resolvedBase: string;
    switch (mode) {
      case "system":
        resolvedBase = getSystemTheme();
        break;
      case "glass":
        resolvedBase = "glass";
        break;
      case "dynamic":
        resolvedBase = "dynamic";
        break;
      default:
        resolvedBase = mode; // "light" or "dark"
    }

    // Set theme attribute
    root.setAttribute("data-theme", resolvedBase);

    // Get color values
    const themeColor = getThemeColor(getColorId(color));
    const rgb = hexToRgb(themeColor.color);

    // Set CSS variables for the selected color
    root.style.setProperty("--accent", themeColor.color);
    root.style.setProperty("--accent-light", themeColor.light);
    root.style.setProperty("--accent-dark", themeColor.dark);
    root.style.setProperty("--accent-glow", themeColor.glow);
    root.style.setProperty("--accent-rgb", rgb);
  };

  // Helper to get color ID from hex
  const getColorId = (hex: string): string => {
    const colorMap: Record<string, string> = {
      "#009faa": "teal",
      "#3b82f6": "blue",
      "#a855f7": "purple",
      "#22c55e": "green",
      "#f97316": "orange",
      "#ec4899": "pink",
      "#ef4444": "red",
      "#6366f1": "indigo",
    };
    return colorMap[hex.toLowerCase()] || "teal";
  };

  const updateTheme = async (newMode: ThemeMode) => {
    setThemeMode(newMode);
    applyTheme(newMode, primaryColor);

    // Save to backend
    try {
      const config: AppConfig = await invoke("get_config");
      await invoke("set_config", {
        newConfig: { ...config, theme: newMode },
      });
    } catch (err) {
      console.error("Failed to save theme:", err);
    }
  };

  const updatePrimaryColor = async (newColor: string) => {
    setPrimaryColor(newColor);
    applyTheme(themeMode, newColor);

    // Save to backend
    try {
      const config: AppConfig = await invoke("get_config");
      await invoke("set_config", {
        newConfig: { ...config, primary_color: newColor },
      });
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
