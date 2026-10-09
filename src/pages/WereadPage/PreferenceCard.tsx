import { Clock, PieChart, Tags } from "lucide-react";
import SectionTitle, { SectionError } from "./SectionTitle";
import { formatHours } from "./format";
import type { Loaded } from "./useLoad";
import type { WereadStats } from "../../api/weread";

interface Props {
  overall: Loaded<WereadStats>;
  onRetry: () => void;
}

const TOP_CATEGORIES = 5;

/** 阅读偏好：常读分类（按阅读时长）+ 一天中的阅读时段分布；接口缺字段时隐藏对应模块 */
export default function PreferenceCard({ overall, onRetry }: Props) {
  let body;
  if (overall.loading && !overall.data) {
    body = <div className="wr-skeleton" style={{ height: 180 }} />;
  } else if (overall.error && !overall.data) {
    body = <SectionError message={`阅读偏好加载失败：${overall.error}`} onRetry={onRetry} />;
  } else {
    const s = overall.data;
    const categories = [...(s?.preferCategory ?? [])]
      .sort((a, b) => b.readingTime - a.readingTime)
      .slice(0, TOP_CATEGORIES);
    const maxCat = Math.max(1, ...categories.map((c) => c.readingTime));
    const hours = s?.preferTime?.length === 24 ? s.preferTime : null;
    const maxHour = hours ? Math.max(1, ...hours) : 1;

    body =
      categories.length === 0 && !hours ? (
        <div className="wr-muted">读得再多一些，这里会展示你的阅读偏好。</div>
      ) : (
        <>
          {(s?.preferCategoryWord || s?.preferTimeWord) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {s?.preferCategoryWord && (
                <span className="wr-pref-word">
                  <Tags size={13} /> {s.preferCategoryWord}
                </span>
              )}
              {s?.preferTimeWord && (
                <span className="wr-pref-word">
                  <Clock size={13} /> {s.preferTimeWord}
                </span>
              )}
            </div>
          )}
          {categories.map((c) => (
            <div key={c.categoryTitle} className="wr-pref-row" title={`${c.readingCount} 本`}>
              <span className="wr-pref-name">{c.categoryTitle}</span>
              <div className="wr-pref-track">
                <div style={{ width: `${(c.readingTime / maxCat) * 100}%` }} />
              </div>
              <span style={{ textAlign: "right" }}>{formatHours(c.readingTime)}</span>
            </div>
          ))}
          {hours && (
            <>
              <div className="wr-hours" title="一天中各时段的阅读分布">
                {hours.map((v, h) => (
                  <div key={h} style={{ height: `${Math.max(6, (v / maxHour) * 100)}%` }} />
                ))}
              </div>
              <div className="wr-hours-axis">
                <span>0 点</span>
                <span>6</span>
                <span>12</span>
                <span>18</span>
                <span>24 点</span>
              </div>
            </>
          )}
        </>
      );
  }

  return (
    <div className="wr-card">
      <SectionTitle icon={<PieChart size={18} />} title="阅读偏好" />
      {body}
    </div>
  );
}
