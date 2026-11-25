import { flushSync } from "react-dom";
import { warnIgnored } from "./log";

/**
 * 书籍卡片封面 ⇄ 详情弹窗封面的共享元素过渡（View Transitions API，无依赖）。
 *
 * - 卡片封面打 `data-cover-id={id}`，弹窗封面固定 `view-transition-name: book-cover`；
 * - 打开：旧快照里给卡片封面临时命名，回调内摘掉名字再渲染弹窗，浏览器把封面从卡片位置变形到弹窗；
 * - 关闭：反过来，回调内把名字还给卡片封面；
 * - 时长与缓动见 animations.css 的 ::view-transition-*；
 * - 不支持（部分 WebKitGTK）、找不到卡片封面或系统「减少动态效果」时直接更新，无过渡。
 */
export const BOOK_COVER_TRANSITION = "book-cover";

type StartViewTransition = (cb: () => void) => { finished: Promise<void> };

function findCover(id: string | number): HTMLElement | null {
  const els = document.querySelectorAll<HTMLElement>(`[data-cover-id="${CSS.escape(String(id))}"]`);
  // 同一本书可能出现在多处（如 3D 书架与网格），取当前可见的那个
  return Array.from(els).find((el) => el.getClientRects().length > 0) ?? null;
}

function run(id: string | number, update: () => void, nameCardInNewState: boolean) {
  const start = (document as Document & { startViewTransition?: StartViewTransition })
    .startViewTransition;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const card = findCover(id);
  if (!start || reduced || !card) {
    update();
    return;
  }
  // 打开：旧状态里卡片封面持有名字；关闭：旧状态里弹窗封面持有名字
  if (!nameCardInNewState) card.style.viewTransitionName = BOOK_COVER_TRANSITION;
  // 过渡期间打标：弹窗挂载时读取并关闭自身淡入 / 上滑，避免与封面变形叠加（见 BookDetailModal）
  const root = document.documentElement;
  root.dataset.bookTransition = "1";
  start
    .call(document, () => {
      card.style.viewTransitionName = nameCardInNewState ? BOOK_COVER_TRANSITION : "";
      flushSync(update);
    })
    .finished.catch(warnIgnored("book_view_transition"))
    .finally(() => {
      card.style.viewTransitionName = "";
      delete root.dataset.bookTransition;
    });
}

/** 当前是否处于书籍共享元素过渡中（弹窗挂载时据此关闭自身入场动画） */
export function isBookTransitionActive(): boolean {
  return document.documentElement.dataset.bookTransition === "1";
}

/** 打开详情弹窗：update 内设置选中书籍 */
export function openBookDetail(id: string | number, update: () => void) {
  run(id, update, false);
}

/** 关闭详情弹窗：update 内清空选中书籍 */
export function closeBookDetail(id: string | number, update: () => void) {
  run(id, update, true);
}
