import { useCallback, useEffect, useState } from "react";
import { Inbox, Loader2, LogIn, RefreshCw } from "lucide-react";
import { feedbackListMine, FEEDBACK_NEED_LOGIN, type MyFeedbackItem } from "../../api/feedback";
import { useWechatLogin } from "../../hooks/useWechatLogin";
import { PrescriberLoginModal } from "../SearchPage/AiFinder";
import {
  FEEDBACK_AREAS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPES,
  ISSUE_STATUS_LABELS,
  labelOf,
} from "./options";

type State =
  | { kind: "loading" }
  | { kind: "need-login" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: MyFeedbackItem[] };

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
};

/** 「我的反馈」：处理状态 + 所属问题进度，已修复的显示「已修复于 vX」 */
export default function MyFeedbackList({ reloadKey }: { reloadKey: number }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", items: await feedbackListMine() });
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, "");
      setState(
        msg === FEEDBACK_NEED_LOGIN ? { kind: "need-login" } : { kind: "error", message: msg },
      );
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载 / 提交新反馈后拉取列表
    load();
  }, [load, reloadKey]);

  const { login, start: startLogin } = useWechatLogin(load);

  if (state.kind === "loading") {
    return (
      <div className="empty-state">
        <Loader2 size={32} className="spinner empty-state-icon" />
        <p className="empty-state-text">正在加载…</p>
      </div>
    );
  }

  if (state.kind === "need-login") {
    return (
      <div className="empty-state">
        <LogIn size={32} className="empty-state-icon" />
        <p className="empty-state-text">登录后查看你提交过的反馈</p>
        <button className="btn btn-primary btn-sm" onClick={startLogin}>
          微信扫码登录
        </button>
        <PrescriberLoginModal login={login} subtitle="登录后查看你提交过的反馈与处理进度" />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="card fb-error">
        <span className="fb-error-text">加载失败：{state.message}</span>
        <button className="btn btn-ghost btn-sm" onClick={load}>
          <RefreshCw size={14} /> 重试
        </button>
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <div className="empty-state">
        <Inbox size={32} className="empty-state-icon" />
        <p className="empty-state-text">还没有提交过反馈</p>
        <p className="empty-state-hint">遇到问题或有好点子，随时告诉我们</p>
      </div>
    );
  }

  return (
    <ul className="fb-list">
      {state.items.map((item) => {
        const status = FEEDBACK_STATUS_LABELS[item.status] ?? { label: item.status, tone: "muted" };
        const fixed = item.issue_status === "fixed" && item.fixed_in_version;
        const progress = item.issue_status ? ISSUE_STATUS_LABELS[item.issue_status] : null;
        return (
          <li key={item.id} className="fb-item">
            <div className="fb-item-main">
              <div className="fb-item-title">{item.title}</div>
              <div className="fb-item-meta">
                {labelOf(FEEDBACK_TYPES, item.type)} · {labelOf(FEEDBACK_AREAS, item.area)} · v
                {item.app_version} · {formatTime(item.created_at)}
              </div>
            </div>
            <div className="fb-item-status">
              <span className={`fb-badge fb-badge-${fixed ? "success" : status.tone}`}>
                {fixed ? `已修复于 v${item.fixed_in_version}` : status.label}
              </span>
              {!fixed && progress && <span className="fb-item-progress">{progress}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
