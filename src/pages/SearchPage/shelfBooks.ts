import { AI_THEMES } from "./aiThemes";
import type { AiInputType } from "./usePrescriber";
import { warnIgnored } from "../../utils/log";

/** 书架上的一本书：点它 = 把 prompt 交给 AI 寻书 */
export interface ShelfBook {
  id: string;
  /** 书脊上的竖排文字 */
  title: string;
  /** 交给 AI 的内容：theme 为后端主题 id，free 为一句自然语言需求 */
  prompt: string;
  kind: AiInputType;
  /** 悬停时浮出的一句话 */
  tagline: string;
  /** 用户自己加的书（可删除） */
  custom?: boolean;
}

/** 内置的自由文本预设：补充后端固定主题之外的常见需求 */
const PRESETS: { id: string; title: string; prompt: string }[] = [
  { id: "history", title: "读史", prompt: "想读点有意思的历史，最好通俗好读" },
  { id: "commute", title: "通勤", prompt: "通勤路上碎片时间读的书，篇幅短、随时能停" },
  { id: "writing", title: "写作", prompt: "想提升写作和表达能力" },
  { id: "scifi", title: "科幻", prompt: "想看几本脑洞大开的科幻小说" },
  { id: "classics", title: "名著", prompt: "想入门世界经典名著，从好读的开始" },
  { id: "economy", title: "经济", prompt: "想了解一些经济学和商业常识" },
];

export const BUILTIN_BOOKS: ShelfBook[] = [
  ...AI_THEMES.map((t) => ({
    id: `theme:${t.id}`,
    title: t.word,
    prompt: t.id,
    kind: "theme" as const,
    tagline: t.riddle,
  })),
  ...PRESETS.map((p) => ({
    id: `preset:${p.id}`,
    title: p.title,
    prompt: p.prompt,
    kind: "free" as const,
    tagline: p.prompt,
  })),
];

export const TITLE_MAX = 8;
export const PROMPT_MAX = 100;
const CUSTOM_MAX = 30;
const STORAGE_KEY = "olib.prescriber.shelf";

interface StoredBook {
  id: string;
  title: string;
  prompt: string;
}

export function loadCustomBooks(): ShelfBook[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as StoredBook[]) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((b) => b?.id && b.title && b.prompt)
      .map((b) => ({ ...b, kind: "free" as const, tagline: b.prompt, custom: true }));
  } catch (err) {
    warnIgnored("prescriber_shelf_load")(err);
    return [];
  }
}

export function saveCustomBooks(books: ShelfBook[]) {
  try {
    const stored: StoredBook[] = books.map(({ id, title, prompt }) => ({ id, title, prompt }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored.slice(-CUSTOM_MAX)));
  } catch (err) {
    warnIgnored("prescriber_shelf_save")(err);
  }
}

export function newCustomBook(title: string, prompt: string): ShelfBook {
  return {
    id: `custom:${Date.now().toString(36)}`,
    title: title.trim().slice(0, TITLE_MAX),
    prompt: prompt.trim().slice(0, PROMPT_MAX),
    kind: "free",
    tagline: prompt.trim(),
    custom: true,
  };
}

/** 书脊外观：颜色、宽、高 */
export interface SpineLook {
  color: string;
  width: number;
  height: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** 两个色相在色环上的距离（0–180） */
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * 给一排书随机配色。色相随机，但饱和度、亮度锁在「布面精装书」的区间：
 * 不刺眼、白字始终清晰；相邻两本色相至少差 40°，避免挤在一起像一本。
 * 高度保证竖排书名放得下。
 */
export function randomLooks(books: ShelfBook[]): Map<string, SpineLook> {
  const looks = new Map<string, SpineLook>();
  let prevHue = rand(0, 360);
  for (const book of books) {
    let hue = rand(0, 360);
    for (let i = 0; i < 12 && hueGap(hue, prevHue) < 40; i++) hue = rand(0, 360);
    prevHue = hue;
    const saturation = Math.round(rand(28, 46));
    const lightness = Math.round(rand(34, 46));
    const titleHeight = book.title.length * (book.title.length > 4 ? 16 : 22) + 44;
    looks.set(book.id, {
      color: `hsl(${Math.round(hue)} ${saturation}% ${lightness}%)`,
      width: Math.round(rand(38, 54)),
      height: Math.max(Math.round(rand(132, 176)), titleHeight),
    });
  }
  return looks;
}
