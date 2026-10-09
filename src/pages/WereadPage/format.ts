// 微信读书页的展示格式化（时长单位均为秒）

/** 短时长：1 小时以上「1.5 小时」，否则「25 分钟」 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0 分钟";
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} 小时`;
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`;
}

/** 累计时长：整数小时，便于大数展示 */
export function formatHours(seconds: number): string {
  if (!seconds || seconds <= 0) return "0 小时";
  const hours = seconds / 3600;
  return hours >= 100 ? `${Math.round(hours)} 小时` : `${hours.toFixed(1)} 小时`;
}

export function minutesOf(seconds: number): number {
  return Math.round((seconds || 0) / 60);
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "夜深了，读几页就早点休息";
  if (h < 11) return "早上好，从一页书开始今天";
  if (h < 14) return "午间小憩，读一会儿吧";
  if (h < 18) return "下午好，给自己一段安静的阅读时间";
  return "晚上好，今天也读一点吧";
}

/** 本地日期键 YYYY-M-D，用于把接口的日起点时间戳对齐到本地日历日 */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** 「106本」→ { value: "106", unit: "本" } */
export function splitCount(counts: string): { value: string; unit: string } {
  const m = /^\s*([\d.,]+)\s*(.*)$/.exec(counts);
  return m ? { value: m[1], unit: m[2] } : { value: counts, unit: "" };
}
