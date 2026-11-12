// 意见反馈选项表。value 与 SCC `app/schemas/feedback.py` 枚举一一对应；
// area 为本应用自维护的固定列表，与 olib-mobile `lib/models/feedback.dart` 共用同一套 slug，
// 新增功能区只追加、不改已有 value（SCC 按 slug 聚类统计）。
import { Bug, Zap, Gauge, Palette, Lightbulb, MoreHorizontal, type LucideIcon } from "lucide-react";

export interface FeedbackOption {
  value: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
}

export const FEEDBACK_TYPES: FeedbackOption[] = [
  { value: "bug", label: "功能异常", icon: Bug },
  { value: "crash", label: "闪退崩溃", icon: Zap },
  { value: "performance", label: "卡顿缓慢", icon: Gauge },
  { value: "ux", label: "界面体验", icon: Palette },
  { value: "feature", label: "功能建议", icon: Lightbulb },
  { value: "other", label: "其他", icon: MoreHorizontal },
];

/** 问题类：额外展示「影响程度」与「复现步骤」 */
export const PROBLEM_TYPES = new Set(["bug", "crash", "performance"]);

export const FEEDBACK_AREAS: FeedbackOption[] = [
  { value: "search", label: "搜索找书" },
  { value: "book_detail", label: "书籍详情" },
  { value: "download", label: "下载" },
  { value: "reader", label: "阅读器" },
  { value: "shelf", label: "书架收藏" },
  { value: "ai_prescriber", label: "AI 寻书" },
  { value: "weread", label: "微信读书" },
  { value: "account", label: "登录账号" },
  // 桌面端特有
  { value: "lan_transfer", label: "无线传书 / 手机联动" },
  { value: "plugin", label: "格式转换 / 插件" },
  { value: "other", label: "其他" },
];

export const FEEDBACK_SEVERITIES: FeedbackOption[] = [
  { value: "minor", label: "小问题", hint: "有点别扭，但不影响使用" },
  { value: "major", label: "影响使用", hint: "部分功能没法正常用" },
  { value: "blocker", label: "完全用不了", hint: "核心功能无法使用" },
];

/** SCC FeedbackStatus（单条反馈的处理状态） */
export const FEEDBACK_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  new: { label: "待处理", tone: "accent" },
  triaged: { label: "已确认", tone: "warning" },
  resolved: { label: "已解决", tone: "success" },
  closed: { label: "已关闭", tone: "muted" },
  wont_fix: { label: "暂不处理", tone: "muted" },
};

/** SCC IssueStatus（所属问题的进度） */
export const ISSUE_STATUS_LABELS: Record<string, string> = {
  open: "排查中",
  planned: "已排期",
  in_progress: "修复中",
  fixed: "已修复",
  wont_fix: "暂不处理",
};

export const labelOf = (options: FeedbackOption[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;

/** 字段上限（与 SCC schema 校验一致） */
export const LIMITS = { title: 100, content: 2000, detail: 1000 } as const;
