export function formatCacheSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 测速阈值：连通且不超过此值即视为可用（绿色） */
const LATENCY_GOOD_MS = 2000;

/**
 * 节点延迟颜色（返回 hex，调用方会拼接透明度后缀如 `${color}15`，故不用 CSS 变量）。
 * 连通（ms ≥ 0，已通过官方健康检查）且 ≤ 2000ms 为绿；连通但更慢为橙；不可达为红。
 */
export function getLatencyColor(ms: number): string {
  if (ms < 0) return "#ef4444"; // red - unreachable
  if (ms <= LATENCY_GOOD_MS) return "#22c55e"; // green
  return "#f97316"; // orange - reachable but slow
}

export function getLatencyText(ms: number): string {
  if (ms < 0) return "超时";
  return `${ms}ms`;
}
