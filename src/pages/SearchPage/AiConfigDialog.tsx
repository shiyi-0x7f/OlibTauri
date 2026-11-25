import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, ListRestart, Loader2, Sparkles, X } from "lucide-react";
import {
  DEFAULT_TIP_COUNT,
  getAiSettings,
  listAiModels,
  MAX_EXTRA_PROMPT_CHARS,
  saveAiSettings,
  testAiSettings,
  TIP_COUNT_OPTIONS,
} from "../../api/ai";
import { AI_PROVIDERS, CUSTOM_PROVIDER_ID, findProvider } from "../../api/aiProviders";
import { warnIgnored } from "../../utils/log";
import ChoiceGroup from "../../components/ChoiceGroup";

interface FormState {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  tipCount: number;
  extraPrompt: string;
}

const DEFAULT_FORM: FormState = {
  provider: AI_PROVIDERS[0].id,
  baseUrl: AI_PROVIDERS[0].baseUrl,
  model: "",
  apiKey: "",
  tipCount: DEFAULT_TIP_COUNT,
  extraPrompt: "",
};

/** 模型下拉里「手动填写」项的值（不会与真实模型名冲突） */
const MANUAL_MODEL = "__manual__";

const PROVIDER_OPTIONS = [
  ...AI_PROVIDERS.map((p) => ({ id: p.id, name: p.name })),
  { id: CUSTOM_PROVIDER_ID, name: "自定义" },
];

/**
 * AI 寻书配置（BYOK + 寻书偏好）。仅在打开时挂载，挂载即读取已保存配置。
 * `onSaved` 在保存并测试通过后调用（如继续未完成的寻书）。
 */
export default function AiConfigDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  // 已拉到列表但用户选择「手动填写」
  const [manualModel, setManualModel] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAiSettings()
      .then((s) => {
        if (!s) {
          setForm(DEFAULT_FORM);
          return;
        }
        setForm({
          provider: s.provider,
          baseUrl: s.base_url,
          model: s.model,
          apiKey: "",
          tipCount: s.tip_count,
          extraPrompt: s.extra_prompt,
        });
        setHasKey(s.has_key);
      })
      .catch((err) => {
        setError(`读取 AI 配置失败：${String(err)}`);
        setForm(DEFAULT_FORM);
      });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!form) return null;

  const preset = findProvider(form.provider);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm({ ...form, [key]: value });

  const selectProvider = (id: string) => {
    const p = findProvider(id);
    // 切换服务商：换地址、清空模型与模型列表（不同服务商模型名不通用）
    setForm({ ...form, provider: id, baseUrl: p ? p.baseUrl : form.baseUrl, model: "" });
    setModels([]);
    setManualModel(false);
  };

  const fetchModels = async () => {
    setLoadingModels(true);
    setError(null);
    try {
      const list = await listAiModels(form.baseUrl, form.apiKey || null);
      setModels(list);
      setManualModel(false);
      if (list.length === 0) setError("该服务商没有返回模型列表，请手动填写模型名");
      else if (!form.model) setForm({ ...form, model: list[0] });
    } catch (err) {
      setError(`获取模型列表失败（可手动填写模型名）：${String(err)}`);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveAiSettings({
        provider: form.provider,
        base_url: form.baseUrl,
        model: form.model,
        api_key: form.apiKey || null,
        tip_count: form.tipCount,
        extra_prompt: form.extraPrompt,
      });
      setHasKey(saved.has_key);
      setForm({ ...form, apiKey: "" });
      await testAiSettings();
      toast.success("已保存，AI 服务可用");
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const openSignup = (url: string) => openUrl(url).catch(warnIgnored("ai_provider_signup"));

  return createPortal(
    <div
      className="prescriber-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="prescriber-modal ai-config-modal" role="dialog" aria-label="AI 寻书设置">
        <button className="btn btn-ghost btn-icon btn-sm config-dialog-close" onClick={onClose}>
          <X size={16} />
        </button>
        <div className="prescriber-modal-title">AI 寻书设置</div>
        <div className="prescriber-modal-sub">
          自带 API Key，请求从本机直连服务商，费用按服务商计费
        </div>

        <div className="config-dialog-field">
          <label>AI 服务</label>
          <ChoiceGroup
            options={PROVIDER_OPTIONS.map((o) => ({ value: o.id, label: o.name }))}
            value={form.provider}
            onChange={selectProvider}
          />
          <div className="config-dialog-hint">
            {preset ? (
              <>
                {preset.hint} ·{" "}
                <a
                  href={preset.signupUrl}
                  onClick={(e) => {
                    e.preventDefault();
                    openSignup(preset.signupUrl);
                  }}
                >
                  没有账号？去注册 <ExternalLink size={11} style={{ verticalAlign: "-1px" }} />
                </a>
              </>
            ) : (
              "任意兼容 OpenAI 接口的服务（含本地 Ollama 等）"
            )}
          </div>
        </div>

        <div className="config-dialog-field">
          <label htmlFor="ai-base-url">接口地址</label>
          <input
            id="ai-base-url"
            className="input"
            placeholder="https://…/v1"
            value={form.baseUrl}
            onChange={(e) => set("baseUrl", e.target.value)}
          />
        </div>

        <div className="config-dialog-field">
          <label htmlFor="ai-api-key">API Key</label>
          <input
            id="ai-api-key"
            className="input"
            type="password"
            placeholder={hasKey ? "已保存，留空则不修改" : "在服务商控制台创建，仅保存在本机"}
            value={form.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
          />
        </div>

        <div className="config-dialog-field">
          <label htmlFor="ai-model">模型</label>
          <div className="config-dialog-row">
            {models.length > 0 && !manualModel ? (
              <select
                id="ai-model"
                className="select"
                value={form.model}
                onChange={(e) => {
                  if (e.target.value === MANUAL_MODEL) setManualModel(true);
                  else set("model", e.target.value);
                }}
              >
                {/* 已保存的模型不在列表里时也保留为可选项 */}
                {form.model && !models.includes(form.model) && (
                  <option value={form.model}>{form.model}</option>
                )}
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value={MANUAL_MODEL}>手动填写…</option>
              </select>
            ) : (
              <input
                id="ai-model"
                className="input"
                placeholder="填好 Key 后点「获取模型」，或直接填写模型名"
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
              />
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={fetchModels}
              disabled={loadingModels || (!form.apiKey && !hasKey)}
            >
              {loadingModels ? (
                <Loader2 size={14} className="spinner" />
              ) : (
                <ListRestart size={14} />
              )}
              获取模型
            </button>
          </div>
        </div>

        <div className="config-dialog-divider" />

        <div className="config-dialog-field">
          <label>每次推荐</label>
          <ChoiceGroup
            options={TIP_COUNT_OPTIONS.map((n) => ({ value: n, label: `${n} 本` }))}
            value={form.tipCount}
            onChange={(n) => set("tipCount", n)}
          />
        </div>

        <div className="config-dialog-field">
          <label htmlFor="ai-extra-prompt">
            补充要求
            <span className="config-dialog-counter">
              {form.extraPrompt.length}/{MAX_EXTRA_PROMPT_CHARS}
            </span>
          </label>
          <textarea
            id="ai-extra-prompt"
            className="input"
            rows={3}
            maxLength={MAX_EXTRA_PROMPT_CHARS}
            placeholder="可选，例如：只推荐中文书；偏好近五年出版的；不要推荐成功学"
            value={form.extraPrompt}
            onChange={(e) => set("extraPrompt", e.target.value)}
          />
        </div>

        {error && <div className="config-dialog-error">{error}</div>}

        <div className="config-dialog-actions">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="spinner" /> : <Sparkles size={14} />}
            保存并测试
          </button>
        </div>
      </div>
    </div>,
    document.getElementById("root") ?? document.body,
  );
}
