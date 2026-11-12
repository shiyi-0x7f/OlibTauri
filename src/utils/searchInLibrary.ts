// 跳转到搜索页并自动按关键词搜索（复用 CommandPalette 的搜索事件机制）
export function searchInLibrary(query: string) {
  const q = query.trim();
  if (!q) return;
  window.dispatchEvent(new CustomEvent("olib:navigate", { detail: "/" }));
  // 等搜索页挂载完成后再派发搜索事件
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent("olib:palette-search", { detail: q }));
  }, 150);
}
