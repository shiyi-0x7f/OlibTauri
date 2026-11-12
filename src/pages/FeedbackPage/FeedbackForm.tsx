import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, Send } from "lucide-react";
import {
  feedbackDiagnostics,
  feedbackSubmit,
  FEEDBACK_DUPLICATE_REF,
  FEEDBACK_NEED_LOGIN,
  type FeedbackDiagnostics,
  type FeedbackInput,
} from "../../api/feedback";
import { useWechatLogin } from "../../hooks/useWechatLogin";
import { PrescriberLoginModal } from "../SearchPage/AiFinder";
import { warnIgnored } from "../../utils/log";
import {
  FEEDBACK_AREAS,
  FEEDBACK_SEVERITIES,
  FEEDBACK_TYPES,
  LIMITS,
  PROBLEM_TYPES,
} from "./options";

/** 「附带设备信息」上次的选择，作为下次默认值（首次默认不勾） */
const CONSENT_KEY = "olib-feedback-diagnostics-consent";

const readConsent = () => {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
};

const stripError = (e: unknown) => String(e).replace(/^Error:\s*/, "");

export default function FeedbackForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [type, setType] = useState("bug");
  const [area, setArea] = useState("");
  const [severity, setSeverity] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [consent, setConsent] = useState(readConsent);
  const [diag, setDiag] = useState<FeedbackDiagnostics | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 每个表单会话一个幂等键：失败重试复用，成功后换新
  const clientRef = useRef(crypto.randomUUID());

  const isProblem = PROBLEM_TYPES.has(type);

  useEffect(() => {
    feedbackDiagnostics().then(setDiag).catch(warnIgnored("feedback_diagnostics"));
  }, []);

  const buildInput = (): FeedbackInput => {
    const trimOrUndef = (s: string) => s.trim() || undefined;
    const details = isProblem
      ? {
          steps: trimOrUndef(steps),
          expected: trimOrUndef(expected),
          actual: trimOrUndef(actual),
        }
      : null;
    const hasDetails = details && Object.values(details).some(Boolean);
    return {
      client_ref: clientRef.current,
      type,
      area,
      severity: isProblem ? severity : null,
      title: title.trim(),
      content: content.trim(),
      details: hasDetails ? details : null,
      diagnostics_consent: consent,
    };
  };

  const reset = () => {
    clientRef.current = crypto.randomUUID();
    setTitle("");
    setContent("");
    setSteps("");
    setExpected("");
    setActual("");
    setSeverity(null);
  };

  const submit = async (retriedRef = false): Promise<void> => {
    setSubmitting(true);
    try {
      await feedbackSubmit(buildInput());
      toast.success("反馈已提交，感谢！处理进度可在「我的反馈」查看");
      reset();
      onSubmitted();
    } catch (e) {
      const msg = stripError(e);
      if (msg === FEEDBACK_NEED_LOGIN) {
        // 扫码登录成功后自动重新提交
        startLogin();
      } else if (msg === FEEDBACK_DUPLICATE_REF && !retriedRef) {
        clientRef.current = crypto.randomUUID();
        return submit(true);
      } else {
        toast.error(`提交失败：${msg}`, { duration: 8000 });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const { login, start: startLogin } = useWechatLogin(() => {
    submit();
  });

  const toggleConsent = (v: boolean) => {
    setConsent(v);
    try {
      localStorage.setItem(CONSENT_KEY, v ? "1" : "0");
    } catch {
      /* 存不下只影响下次默认值 */
    }
  };

  const unsupported = diag !== null && diag.platform === null;
  const missing = !area
    ? "请选择功能区"
    : !title.trim()
      ? "请填写标题"
      : !content.trim()
        ? "请填写描述"
        : null;
  const diagSummary = [diag?.device_model, diag?.os_version].filter(Boolean).join(" · ");

  return (
    <div className="fb-form">
      {/* 类型：6 项，分段单选 */}
      <section className="fb-field">
        <div className="fb-label">反馈类型</div>
        <div className="fb-chips" role="radiogroup" aria-label="反馈类型">
          {FEEDBACK_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={type === t.value}
              className={`fb-chip ${type === t.value ? "active" : ""}`}
              onClick={() => setType(t.value)}
            >
              {t.icon && <t.icon size={14} />}
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {/* 功能区：11 项，下拉 */}
      <section className="fb-field">
        <label className="fb-label" htmlFor="fb-area">
          功能区
        </label>
        <select
          id="fb-area"
          className="select fb-select"
          value={area}
          onChange={(e) => setArea(e.target.value)}
        >
          <option value="" disabled>
            选择问题出在哪个功能…
          </option>
          {FEEDBACK_AREAS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </section>

      {/* 影响程度：问题类才显示，3 项单选卡片 */}
      {isProblem && (
        <section className="fb-field">
          <div className="fb-label">
            影响程度 <span className="fb-optional">选填</span>
          </div>
          <div className="fb-severity" role="radiogroup" aria-label="影响程度">
            {FEEDBACK_SEVERITIES.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={severity === s.value}
                className={`fb-severity-card ${severity === s.value ? "active" : ""}`}
                data-level={s.value}
                onClick={() => setSeverity(severity === s.value ? null : s.value)}
              >
                <span className="fb-severity-title">{s.label}</span>
                <span className="fb-severity-hint">{s.hint}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="fb-field">
        <label className="fb-label" htmlFor="fb-title">
          标题
          <span className="fb-count">
            {title.length}/{LIMITS.title}
          </span>
        </label>
        <input
          id="fb-title"
          className="input"
          maxLength={LIMITS.title}
          placeholder={isProblem ? "一句话说明问题，如：下载到 99% 卡住" : "一句话概括你的想法"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </section>

      <section className="fb-field">
        <label className="fb-label" htmlFor="fb-content">
          详细描述
          <span className="fb-count">
            {content.length}/{LIMITS.content}
          </span>
        </label>
        <textarea
          id="fb-content"
          className="input fb-textarea"
          rows={5}
          maxLength={LIMITS.content}
          placeholder={
            isProblem
              ? "发生了什么？在什么情况下出现？出现了几次？"
              : "希望增加或改进什么？会在什么场景下用到？"
          }
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </section>

      {isProblem && (
        <details className="fb-details">
          <summary>补充复现信息（选填，能大大加快定位）</summary>
          <div className="fb-details-body">
            {(
              [
                ["复现步骤", steps, setSteps, "1. 打开…  2. 点击…  3. 出现…"],
                ["期望结果", expected, setExpected, "本来应该怎样"],
                ["实际结果", actual, setActual, "实际发生了什么，有报错可直接粘贴"],
              ] as const
            ).map(([label, value, setter, placeholder]) => (
              <div className="fb-field" key={label}>
                <div className="fb-label">
                  {label}
                  <span className="fb-count">
                    {value.length}/{LIMITS.detail}
                  </span>
                </div>
                <textarea
                  className="input fb-textarea"
                  rows={2}
                  maxLength={LIMITS.detail}
                  placeholder={placeholder}
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                />
              </div>
            ))}
          </div>
        </details>
      )}

      {/* 设备信息：所见即所发，首次默认不勾 */}
      <label className="fb-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => toggleConsent(e.target.checked)}
        />
        <span>
          附带设备信息（设备型号、系统版本），帮助我们定位问题
          {diagSummary && <span className="fb-consent-value">{diagSummary}</span>}
        </span>
      </label>

      <div className="fb-actions">
        <span className="fb-hint">
          {unsupported
            ? "当前系统暂不支持提交反馈"
            : (missing ??
              `将以 v${diag?.app_version ?? "…"} 提交，需微信扫码登录（与 AI 寻书共用）`)}
        </span>
        <button
          className="btn btn-primary"
          disabled={submitting || unsupported || missing !== null}
          onClick={() => submit()}
        >
          {submitting ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          提交反馈
        </button>
      </div>

      <PrescriberLoginModal
        login={login}
        subtitle="登录后即可提交反馈，并在「我的反馈」查看处理进度"
      />
    </div>
  );
}
