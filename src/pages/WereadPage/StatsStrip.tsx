import type { ReactNode } from "react";
import { BookCheck, BookMarked, CalendarDays, Clock3, NotebookPen, Timer } from "lucide-react";
import { formatDuration, formatHours, splitCount } from "./format";
import { SectionError } from "./SectionTitle";
import type { Loaded } from "./useLoad";
import type { WereadStats } from "../../api/weread";

interface Props {
  overall: Loaded<WereadStats>;
  onRetry: () => void;
}

interface Tile {
  icon: ReactNode;
  color: string;
  value: string;
  label: string;
  hint?: string;
}

/** 累计数据条：时长 / 天数 / 读过 / 读完 / 笔记 / 日均 */
export default function StatsStrip({ overall, onRetry }: Props) {
  if (overall.loading && !overall.data) {
    return (
      <div className="wr-stats">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="wr-skeleton" style={{ height: 72, borderRadius: 16 }} />
        ))}
      </div>
    );
  }
  if (overall.error && !overall.data) {
    return (
      <div className="wr-card">
        <SectionError message={`累计数据加载失败：${overall.error}`} onRetry={onRetry} />
      </div>
    );
  }

  const s = overall.data;
  const stat = (name: string) => {
    const hit = s?.readStat?.find((r) => r.stat === name);
    return hit ? splitCount(hit.counts).value : "—";
  };

  const tiles: Tile[] = [
    {
      icon: <Clock3 size={18} />,
      color: "var(--accent)",
      value: formatHours(s?.totalReadTime ?? 0),
      label: "累计阅读",
    },
    {
      icon: <CalendarDays size={18} />,
      color: "#8b5cf6",
      value: `${s?.readDays ?? 0} 天`,
      label: "阅读天数",
    },
    {
      icon: <BookMarked size={18} />,
      color: "#3b82f6",
      value: `${stat("读过")} 本`,
      label: "读过",
    },
    { icon: <BookCheck size={18} />, color: "#22c55e", value: `${stat("读完")} 本`, label: "读完" },
    {
      icon: <NotebookPen size={18} />,
      color: "#f59e0b",
      value: `${stat("笔记")} 条`,
      label: "笔记",
    },
    {
      icon: <Timer size={18} />,
      color: "#ec4899",
      value: formatDuration(s?.dayAverageReadTime ?? 0),
      label: "日均阅读",
      hint: "累计阅读时长 ÷ 阅读天数（只计有阅读记录的日子）",
    },
  ];

  return (
    <div className="wr-stats">
      {tiles.map((t) => (
        <div key={t.label} className="wr-stat" title={t.hint}>
          <div
            className="wr-stat-icon"
            style={{
              color: t.color,
              background: `color-mix(in srgb, ${t.color} 14%, transparent)`,
            }}
          >
            {t.icon}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="wr-stat-value">{t.value}</div>
            <div className="wr-stat-label">{t.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
