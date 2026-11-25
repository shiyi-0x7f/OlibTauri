import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  ACCOUNT_CHANGED_EVENT,
  prescriberLogout,
  prescriberStatus,
  type PrescriberAuthState,
} from "../../api/prescriber";

const notifyChanged = () => window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT));

/**
 * 反馈页右上角的微信账号状态（scc 扫码登录，仅意见反馈 / 社群专线使用）。
 * 仅已登录时显示「微信已登录 · 退出」；未登录时提交反馈会自行弹出扫码，这里不占位。
 */
export default function FeedbackAccount() {
  const [state, setState] = useState<PrescriberAuthState | null>(null);

  const load = useCallback(() => {
    prescriberStatus()
      .then(setState)
      .catch((err) => toast.error(`读取微信登录状态失败：${String(err)}`, { duration: 6000 }));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(ACCOUNT_CHANGED_EVENT, load);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, load);
  }, [load]);

  if (!state?.authorized) return null;

  const handleLogout = async () => {
    const ok = await confirm("退出后，提交反馈时需要重新扫码。", {
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

  return (
    <div className="fb-account">
      微信已登录{state.nickname ? `：${state.nickname}` : ""}
      {state.expired && "（已过期，提交时将重新扫码）"}
      <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
        退出
      </button>
    </div>
  );
}
