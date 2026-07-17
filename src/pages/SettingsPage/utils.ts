export function formatCacheSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function getLatencyColor(ms: number): string {
    if (ms < 0) return "#ef4444"; // red - unreachable
    if (ms <= 200) return "#22c55e"; // green
    if (ms <= 500) return "#eab308"; // yellow
    if (ms <= 2000) return "#f97316"; // orange
    return "#ef4444"; // red
}

export function getLatencyText(ms: number): string {
    if (ms < 0) return "超时";
    return `${ms}ms`;
}
