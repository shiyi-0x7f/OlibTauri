/** Z站登录弹窗事件；`detail.reason` 为弹窗顶部显示的原因（可选） */
export const SHOW_LOGIN_EVENT = "olib:show-login";

export interface ShowLoginDetail {
  reason?: string;
}

/** 打开 Z站账号登录弹窗 */
export function requestZlibLogin(reason?: string) {
  window.dispatchEvent(new CustomEvent<ShowLoginDetail>(SHOW_LOGIN_EVENT, { detail: { reason } }));
}

/** 后端「未登录 Z站账号」类错误（下载见 src-tauri/src/download.rs translate_error，搜索见 search_commands） */
export function isZlibLoginRequired(errStr: string): boolean {
  return errStr.includes("未登录") || errStr.includes("Please login");
}

/**
 * 下载失败的提示文案（额度用尽另由 DownloadLimitDialog 处理）。
 * 用户主动取消返回 null，不提示；后端文案已带「下载失败」前缀时不再重复。
 * 未登录 Z站账号时直接弹出登录弹窗（用户常误以为微信扫码就是登录），返回 null。
 */
export function describeDownloadError(err: unknown): string | null {
  const errStr = String(err);
  if (errStr.includes("cancelled")) return null;
  if (isZlibLoginRequired(errStr)) {
    requestZlibLogin("下载电子书需要先登录 Z站账号");
    return null;
  }
  return errStr.startsWith("下载失败") ? errStr : `下载失败：${errStr}`;
}
