import { useState } from "react";
import { Activity } from "lucide-react";
import SectionTitle, { SectionError } from "./SectionTitle";
import { dayKey, formatDuration, minutesOf } from "./format";
import { warnIgnored } from "../../utils/log";
import type { Loaded } from "./useLoad";
import type { WereadStats } from "../../api/weread";

const GOAL_KEY = "olib.weread.dailyGoalMinutes";
const GOALS = [10, 20, 30, 60];
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function readGoal(): number {
  try {
    const v = Number(localStorage.getItem(GOAL_KEY));
    return GOALS.includes(v) ? v : 20;
  } catch {
    return 20; // 存储不可用时用默认目标
  }
}

interface Props {
  weekly: Loaded<WereadStats>;
  onRetry: () => void;
}

/** 阅读节奏：今日目标进度 + 本周 7 天柱状图（目标仅存本机） */
export default function ReadingRhythmCard({ weekly, onRetry }: Props) {
  const [goal, setGoal] = useState(readGoal);

  const changeGoal = (value: number) => {
    setGoal(value);
    try {
      localStorage.setItem(GOAL_KEY, String(value));
    } catch (err) {
      warnIgnored("weread_goal_save")(err);
    }
  };

  let body;
  if (weekly.loading && !weekly.data) {
    body = <div className="wr-skeleton" style={{ height: 170 }} />;
  } else if (weekly.error && !weekly.data) {
    body = <SectionError message={`阅读统计加载失败：${weekly.error}`} onRetry={onRetry} />;
  } else {
    const stats = weekly.data;
    const byDay = new Map<string, number>();
    for (const [ts, secs] of Object.entries(stats?.readTimes ?? {})) {
      byDay.set(dayKey(new Date(Number(ts) * 1000)), secs);
    }
    const now = new Date();
    const todayKey = dayKey(now);
    // baseTime 为本周一 0 点；缺失时按本地日历推算
    const monday = stats?.baseTime
      ? new Date(stats.baseTime * 1000)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const days = WEEKDAYS.map((label, i) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const key = dayKey(d);
      return { label, seconds: byDay.get(key) ?? 0, today: key === todayKey, future: d > now };
    });
    const todaySeconds = days.find((d) => d.today)?.seconds ?? 0;
    const max = Math.max(goal * 60, ...days.map((d) => d.seconds));
    const percent = Math.min(100, (todaySeconds / (goal * 60)) * 100);

    body = (
      <>
        <div className="wr-rhythm-top">
          <div>
            <div className="wr-muted">今日阅读</div>
            <div className="wr-rhythm-value" style={{ marginTop: 4 }}>
              {minutesOf(todaySeconds)}
              <small>/ {goal} 分钟</small>
            </div>
          </div>
          <div className="wr-segmented" title="每日阅读目标（仅保存在本机）">
            {GOALS.map((g) => (
              <button key={g} className={g === goal ? "active" : ""} onClick={() => changeGoal(g)}>
                {g}分
              </button>
            ))}
          </div>
        </div>
        <div className="wr-goal-track">
          <div style={{ width: `${percent}%` }} />
        </div>
        <div className="wr-week">
          {days.map((d) => (
            <div
              key={d.label}
              className={`wr-week-col${d.today ? " today" : ""}${d.future ? " future" : ""}`}
              title={`周${d.label}：${formatDuration(d.seconds)}`}
            >
              <div className="wr-week-min">{d.seconds > 0 ? minutesOf(d.seconds) : ""}</div>
              <div
                className="wr-week-bar"
                style={{ height: `${Math.max(4, (d.seconds / max) * 72)}px` }}
              />
              <div className="wr-week-label">{d.today ? "今天" : d.label}</div>
            </div>
          ))}
        </div>
        <div className="wr-muted" style={{ marginTop: 12 }}>
          本周累计 {formatDuration(stats?.totalReadTime ?? 0)} · 读了 {stats?.readDays ?? 0} 天
        </div>
      </>
    );
  }

  return (
    <div className="wr-card">
      <SectionTitle icon={<Activity size={18} />} title="阅读节奏" sub="柱上数字为分钟" />
      {body}
    </div>
  );
}
