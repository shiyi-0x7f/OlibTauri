/**
 * 下载失败的提示文案（额度用尽另由 DownloadLimitDialog 处理）。
 * 用户主动取消返回 null，不提示；后端文案已带「下载失败」前缀时不再重复。
 */
export function describeDownloadError(err: unknown): string | null {
  const errStr = String(err);
  if (errStr.includes("cancelled")) return null;
  return errStr.startsWith("下载失败") ? errStr : `下载失败：${errStr}`;
}
