// Theme color definitions
export interface ThemeColor {
  id: string;
  name: string;
  color: string;
  light: string;
  dark: string;
  glow: string;
}

export const THEME_COLORS: ThemeColor[] = [
  {
    id: "teal",
    name: "青色",
    color: "#009faa",
    light: "#00c4d0",
    dark: "#007a83",
    glow: "rgba(0, 159, 170, 0.3)",
  },
  {
    id: "blue",
    name: "蓝色",
    color: "#3b82f6",
    light: "#60a5fa",
    dark: "#2563eb",
    glow: "rgba(59, 130, 246, 0.3)",
  },
  {
    id: "purple",
    name: "紫色",
    color: "#a855f7",
    light: "#c084fc",
    dark: "#9333ea",
    glow: "rgba(168, 85, 247, 0.3)",
  },
  {
    id: "green",
    name: "绿色",
    color: "#22c55e",
    light: "#4ade80",
    dark: "#16a34a",
    glow: "rgba(34, 197, 94, 0.3)",
  },
  {
    id: "orange",
    name: "橙色",
    color: "#f97316",
    light: "#fb923c",
    dark: "#ea580c",
    glow: "rgba(249, 115, 22, 0.3)",
  },
  {
    id: "pink",
    name: "粉色",
    color: "#ec4899",
    light: "#f472b6",
    dark: "#db2777",
    glow: "rgba(236, 72, 153, 0.3)",
  },
  {
    id: "red",
    name: "红色",
    color: "#ef4444",
    light: "#f87171",
    dark: "#dc2626",
    glow: "rgba(239, 68, 68, 0.3)",
  },
  {
    id: "indigo",
    name: "靛蓝",
    color: "#6366f1",
    light: "#818cf8",
    dark: "#4f46e5",
    glow: "rgba(99, 102, 241, 0.3)",
  },
];

// Get theme color by ID
export function getThemeColor(colorId: string): ThemeColor {
  return THEME_COLORS.find((c) => c.id === colorId) || THEME_COLORS[0];
}

// Convert hex color to RGB values for CSS
export function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "0, 159, 170"; // fallback to teal
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}
