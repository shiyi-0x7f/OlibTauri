import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { aiFindBooks, NEED_AI_CONFIG, type ReadingBag } from "../../api/ai";
import { warnIgnored } from "../../utils/log";
import { themeLabel } from "./aiThemes";

const LOADING_LINES = [
  "正在翻阅书海……",
  "为你斟酌合适的书……",
  "把心事交给书页……",
  "马上就好，好书值得等待……",
];

const HISTORY_KEY = "olib.prescriber.history";
const HISTORY_MAX = 8;

export type AiInputType = "free" | "theme";

/** 一次寻书：请求 + 结果；存本机供「最近的书单」免请求重开 */
export interface AiQuery {
  input: string;
  inputType: AiInputType;
  /** 展示用：自由输入原文或主题文案 */
  label: string;
}

export interface AiHistoryEntry extends AiQuery {
  bag: ReadingBag;
  at: number;
}

const stripError = (e: unknown) => String(e).replace(/^Error:\s*/, "");

function labelOf(input: string, inputType: AiInputType): string {
  return inputType === "theme" ? themeLabel(input) : input;
}

function loadHistory(): AiHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? (JSON.parse(raw) as AiHistoryEntry[]) : [];
    return Array.isArray(list) ? list.filter((h) => h?.bag?.tips?.length) : [];
  } catch (err) {
    warnIgnored("prescriber_history_load")(err);
    return [];
  }
}

function saveHistory(list: AiHistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch (err) {
    warnIgnored("prescriber_history_save")(err);
  }
}

/** AI 寻书（阅读锦囊，BYOK）：寻书、未配置时弹出配置并在保存后续寻、最近书单 */
export function usePrescriber() {
  const [loading, setLoading] = useState(false);
  const [bag, setBag] = useState<ReadingBag | null>(null);
  const [query, setQuery] = useState<AiQuery | null>(null);
  const [drawId, setDrawId] = useState(0); // 每次出结果自增，触发入场动画
  const [loadingLine, setLoadingLine] = useState(LOADING_LINES[0]);
  const [history, setHistory] = useState<AiHistoryEntry[]>(loadHistory);
  const [configOpen, setConfigOpen] = useState(false);
  // 因未配置而中断的寻书，配置保存后自动继续
  const pending = useRef<AiQuery | null>(null);

  useEffect(() => {
    if (!loading) return;
    let i = 0;
    const t = window.setInterval(() => {
      i = (i + 1) % LOADING_LINES.length;
      setLoadingLine(LOADING_LINES[i]);
    }, 2500);
    return () => window.clearInterval(t);
  }, [loading]);

  const diagnose = async (text: string, inputType: AiInputType) => {
    const input = text.trim();
    if (!input) {
      toast.error("说说你最近的状态或想读什么吧");
      return;
    }
    const q: AiQuery = { input, inputType, label: labelOf(input, inputType) };
    setLoading(true);
    setBag(null);
    setQuery(q);
    try {
      const result = await aiFindBooks({ input, inputType });
      setBag(result);
      setDrawId((n) => n + 1);
      if (result.tips.length > 0) {
        setHistory((prev) => {
          const next = [
            { ...q, bag: result, at: Date.now() },
            ...prev.filter((h) => !(h.input === input && h.inputType === inputType)),
          ].slice(0, HISTORY_MAX);
          saveHistory(next);
          return next;
        });
      }
    } catch (e) {
      if (String(e).includes(NEED_AI_CONFIG)) {
        pending.current = q;
        setQuery(null);
        setConfigOpen(true);
      } else {
        toast.error(stripError(e), { duration: 8000 });
      }
    } finally {
      setLoading(false);
    }
  };

  /** 重开历史书单：直接用本地结果，不再请求 AI */
  const restore = (entry: AiHistoryEntry) => {
    setQuery({ input: entry.input, inputType: entry.inputType, label: entry.label });
    setBag(entry.bag);
    setDrawId((n) => n + 1);
  };

  const removeHistory = (entry: AiHistoryEntry) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.at !== entry.at);
      saveHistory(next);
      return next;
    });
  };

  return {
    loading,
    loadingLine,
    bag,
    query,
    drawId,
    history,
    diagnose,
    /** 同一需求再要一批 */
    again: () => query && diagnose(query.input, query.inputType),
    restore,
    removeHistory,
    clear: () => {
      setBag(null);
      setQuery(null);
    },
    configOpen,
    openConfig: () => setConfigOpen(true),
    closeConfig: () => {
      pending.current = null;
      setConfigOpen(false);
    },
    /** 配置保存并测试通过：关闭弹窗，若有被中断的寻书则继续 */
    onConfigSaved: () => {
      setConfigOpen(false);
      const next = pending.current;
      pending.current = null;
      if (next) diagnose(next.input, next.inputType);
    },
  };
}

export type Prescriber = ReturnType<typeof usePrescriber>;
