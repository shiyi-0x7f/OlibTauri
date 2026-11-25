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

const HEX_RE = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

function parseHex(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** 与目标色按比例混合（ratio 0..1，目标 255 为提亮、0 为压暗） */
function mix(rgb: [number, number, number], target: number, ratio: number): string {
  return toHex(rgb.map((v) => v + (target - v) * ratio) as [number, number, number]);
}

/**
 * 主题色 → 完整色板。预设色直接取预设；调色盘选的自定义色按比例推算
 * light（混 25% 白）/ dark（混 20% 黑）/ glow（30% 透明）。无效值回落到青色。
 */
export function resolveThemeColor(hex: string): ThemeColor {
  const normalized = hex.toLowerCase();
  const preset = THEME_COLORS.find((c) => c.color === normalized);
  if (preset) return preset;
  const rgb = parseHex(normalized);
  if (!rgb) return THEME_COLORS[0];
  return {
    id: "custom",
    name: "自定义",
    color: toHex(rgb),
    light: mix(rgb, 255, 0.25),
    dark: mix(rgb, 0, 0.2),
    glow: `rgba(${rgb.join(", ")}, 0.3)`,
  };
}

// Convert hex color to RGB values for CSS
export function hexToRgb(hex: string): string {
  const rgb = parseHex(hex);
  return rgb ? rgb.join(", ") : "0, 159, 170"; // fallback to teal
}
