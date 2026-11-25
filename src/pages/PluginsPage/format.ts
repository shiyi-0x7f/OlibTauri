export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatSpeed(kbps: number): string {
  if (kbps <= 0) return "";
  return kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${kbps.toFixed(0)} KB/s`;
}

/** 插件主题色：卡片图标与存储条分段共用，按插件在列表中的位置固定分配 */
const TONES = ["var(--accent)", "#8b5cf6", "#f59e0b", "#ec4899", "#3b82f6", "#22c55e"];

export function toneAt(index: number): string {
  return TONES[index % TONES.length];
}
