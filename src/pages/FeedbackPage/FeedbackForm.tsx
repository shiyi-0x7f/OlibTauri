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

/** 自动生成的标题长度（远低于 LIMITS.title，「我的反馈」列表里一眼可读） */
const AUTO_TITLE_CHARS = 40;

/** SCC 要求标题：取描述首个非空行，超长截断加省略号，用户只需填一段描述 */
function deriveTitle(content: string): string {
  const firstLine = content.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const chars = [...firstLine.trim()];
  const limit = Math.min(AUTO_TITLE_CHARS, LIMITS.title);
  return chars.length > limit ? `${chars.slice(0, limit - 1).join("")}…` : chars.join("");
}

export default function FeedbackForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [type, setType] = useState("bug");
  const [area, setArea] = useState("");
  const [severity, setSeverity] = useState<string | null>(null);
  const [content, setContent] = useState("");
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
    return {
      client_ref: clientRef.current,
      type,
      area,
      severity: isProblem ? severity : null,
      title: deriveTitle(content),
      content: content.trim(),
      // 复现步骤 / 期望 / 实际三栏已移除（用户看不懂），统一写在描述里
      details: null,
      diagnostics_consent: consent,
    };
  };

  const reset = () => {
    clientRef.current = crypto.randomUUID();
    setContent("");
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
  const missing = !area ? "请选择功能区" : !content.trim() ? "请填写描述" : null;
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
        <label className="fb-label" htmlFor="fb-content">
          描述
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
              ? "如：下载到 99% 卡住，重试也不行。在什么情况下出现？出现了几次？"
              : "如：希望支持按作者筛选。会在什么场景下用到？"
          }
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </section>

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
            : (missing ?? `将以 v${diag?.app_version ?? "…"} 提交，需微信扫码登录`)}
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
