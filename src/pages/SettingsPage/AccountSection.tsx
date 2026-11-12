import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { confirm } from "@tauri-apps/plugin-dialog";
import { LogOut, QrCode, UserRound } from "lucide-react";
import {
  prescriberLogout,
  prescriberStatus,
  ACCOUNT_CHANGED_EVENT,
  type PrescriberAuthState,
} from "../../api/prescriber";
import { useWechatLogin } from "../../hooks/useWechatLogin";
import { PrescriberLoginModal } from "../SearchPage/AiFinder";

const notifyChanged = () => window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT));

/**
 * 设置页「微信账号」：scc 公众号扫码登录的状态 / 登录 / 退出。
 * 一次登录同时用于 AI 寻书与意见反馈（与 Z-Library 下载账号无关）。
 */
export default function AccountSection() {
  const [state, setState] = useState<PrescriberAuthState | null>(null);

  const load = useCallback(() => {
    prescriberStatus()
      .then(setState)
      .catch((err) => toast.error(`读取登录状态失败：${String(err)}`, { duration: 6000 }));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(ACCOUNT_CHANGED_EVENT, load);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, load);
  }, [load]);

  const { login, start } = useWechatLogin(notifyChanged);

  const handleLogout = async () => {
    const ok = await confirm("退出后，使用 AI 寻书或提交反馈时需要重新扫码。", {
      title: "退出微信账号",
      kind: "warning",
    });
    if (!ok) return;
    try {
      await prescriberLogout();
      toast.success("已退出微信账号");
      notifyChanged();
    } catch (err) {
      toast.error(`退出失败：${String(err)}`, { duration: 6000 });
    }
  };

  const loggedIn = state?.authorized && !state.expired;
  const desc =
    state === null ? (
      "读取中…"
    ) : loggedIn ? (
      <span style={{ color: "var(--success)" }}>
        已登录{state.nickname ? `：${state.nickname}` : ""}
      </span>
    ) : state.expired ? (
      <span style={{ color: "var(--warning, #f59e0b)" }}>登录已过期，请重新扫码</span>
    ) : (
      "未登录"
    );

  return (
    <div className="card settings-grid-full">
      <div className="settings-group">
        <div className="settings-group-title">
          <UserRound size={16} style={{ marginRight: "6px", verticalAlign: "-2px" }} />
          微信账号
        </div>

        <div className="settings-item">
          <div className="settings-item-info">
            <div className="settings-item-title">登录状态</div>
            <div className="settings-item-desc">
              {desc}
              <br />
              微信扫码登录一次，即可使用 AI 寻书与意见反馈
            </div>
          </div>
          <div className="flex gap-2">
            {!loggedIn && (
              <button className="btn btn-primary btn-sm" onClick={start} disabled={state === null}>
                <QrCode size={14} /> {state?.expired ? "重新扫码登录" : "扫码登录"}
              </button>
            )}
            {state?.authorized && (
              <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
                <LogOut size={14} /> 退出登录
              </button>
            )}
          </div>
        </div>
      </div>

      <PrescriberLoginModal login={login} subtitle="用微信扫码登录，AI 寻书与意见反馈共用此账号" />
    </div>
  );
}
