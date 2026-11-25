import { useEffect, useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import {
  getKindleSettings,
  saveKindleSettings,
  securityForPort,
  testKindleSmtp,
  type SmtpSecurity,
} from "../api/kindle";
import ChoiceGroup from "./ChoiceGroup";

interface FormState {
  to: string;
  from: string;
  smtpHost: string;
  smtpPort: string;
  security: SmtpSecurity;
  password: string;
}

const EMPTY: FormState = {
  to: "",
  from: "",
  smtpHost: "",
  smtpPort: "465",
  security: "tls",
  password: "",
};

const SECURITY_OPTIONS: { value: SmtpSecurity; label: string }[] = [
  { value: "tls", label: "SSL/TLS" },
  { value: "starttls", label: "STARTTLS" },
];

/**
 * Send to Kindle 的 SMTP 配置弹窗。仅在打开时挂载，挂载即读取已保存配置。
 * `initialError` 用于发送失败后打开时直接显示原因；`onSaved` 在保存并测试通过后调用（如继续发送）。
 */
export default function KindleConfigDialog({
  initialError,
  onClose,
  onSaved,
}: {
  initialError?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  useEffect(() => {
    getKindleSettings()
      .then((s) => {
        if (!s) {
          setForm(EMPTY);
          return;
        }
        setForm({
          to: s.to,
          from: s.from,
          smtpHost: s.smtp_host,
          smtpPort: String(s.smtp_port),
          security: s.security,
          password: "",
        });
        setHasPassword(s.has_password);
      })
      .catch((err) => {
        setError(`读取 Kindle 配置失败：${String(err)}`);
        setForm(EMPTY);
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

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm({ ...form, [key]: value });

  const handlePortChange = (value: string) => {
    const port = Number(value);
    // 端口变化时按标准端口预选加密方式，用户仍可手动改
    setForm({
      ...form,
      smtpPort: value,
      security: port > 0 ? securityForPort(port) : form.security,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveKindleSettings({
        to: form.to,
        from: form.from,
        smtp_host: form.smtpHost,
        smtp_port: Number(form.smtpPort) || 0,
        security: form.security,
        password: form.password || null,
      });
      setHasPassword(saved.has_password);
      setForm({ ...form, password: "" });
      await testKindleSmtp();
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="Kindle 设置"
        style={{ position: "relative" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="btn btn-ghost btn-icon btn-sm config-dialog-close" onClick={onClose}>
          <X size={16} />
        </button>
        <h2 className="modal-title" style={{ marginBottom: 4 }}>
          发送到 Kindle
        </h2>
        <div className="config-dialog-hint">
          用你的邮箱把书作为附件发到 Kindle；发件邮箱需先加入亚马逊「已认可的发件人电子邮箱列表」。
          配置仅保存在本机。
        </div>

        <div className="config-dialog-field">
          <label htmlFor="kindle-to">Kindle 收件地址</label>
          <input
            id="kindle-to"
            className="input"
            placeholder="name@kindle.com（亚马逊「个人文档设置」中查看）"
            value={form.to}
            onChange={(e) => set("to", e.target.value)}
          />
        </div>

        <div className="config-dialog-field">
          <label htmlFor="kindle-from">发件邮箱</label>
          <input
            id="kindle-from"
            className="input"
            placeholder="name@qq.com"
            value={form.from}
            onChange={(e) => set("from", e.target.value)}
          />
        </div>

        <div className="config-dialog-field">
          <label htmlFor="kindle-host">SMTP 服务器与端口</label>
          <div className="config-dialog-row">
            <input
              id="kindle-host"
              className="input"
              placeholder="smtp.qq.com"
              value={form.smtpHost}
              onChange={(e) => set("smtpHost", e.target.value)}
            />
            <input
              className="input"
              style={{ flex: "0 0 76px" }}
              inputMode="numeric"
              aria-label="SMTP 端口"
              value={form.smtpPort}
              onChange={(e) => handlePortChange(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        </div>

        <div className="config-dialog-field">
          <label>加密方式</label>
          <ChoiceGroup
            options={SECURITY_OPTIONS}
            value={form.security}
            onChange={(v) => set("security", v)}
          />
          <div className="config-dialog-hint">按端口自动选择；与邮箱服务商说明不符时手动切换</div>
        </div>

        <div className="config-dialog-field">
          <label htmlFor="kindle-password">授权码</label>
          <input
            id="kindle-password"
            className="input"
            type="password"
            placeholder={
              hasPassword ? "已保存，留空则不修改" : "邮箱设置中开启 SMTP 后生成，通常不是登录密码"
            }
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </div>

        {error && <div className="config-dialog-error">{error}</div>}

        <div className="config-dialog-actions">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="spinner" /> : <Send size={14} />}
            保存并发送
          </button>
        </div>
      </div>
    </div>
  );
}
