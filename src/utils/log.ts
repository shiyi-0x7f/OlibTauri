/**
 * 降级路径统一记录被忽略的错误，替代裸 `.catch(() => null)`——
 * 静默吞错会让线上问题无迹可循（生产构建剥离 console，不影响用户）。
 */
export function warnIgnored(context: string) {
  return (err: unknown): null => {
    console.warn(`[降级] ${context}:`, err);
    return null;
  };
}
