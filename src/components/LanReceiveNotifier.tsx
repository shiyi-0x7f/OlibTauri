import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import toast from "react-hot-toast";
import { FolderOpen, Inbox } from "lucide-react";
import {
  LAN_BOOKLIST_RECEIVED,
  LAN_FILE_RECEIVED,
  LAN_RECEIVED_WINDOW_EVENT,
  type LanBooklistReceived,
  type LanFileReceived,
  type LanReceivedKind,
} from "../api/lan";
import { getConfig } from "../api/config";
import { openInExplorer } from "../api/bookshelf";
import { playDownloadSound } from "../utils/downloadSound";
import { warnIgnored } from "../utils/log";

/** 手机批量发书时逐本到达，这段时间内到达的合并成一条提示 */
const MERGE_WINDOW_MS = 1500;

function notifyRefresh(kind: LanReceivedKind) {
  window.dispatchEvent(new CustomEvent(LAN_RECEIVED_WINDOW_EVENT, { detail: kind }));
}

async function openDownloadFolder() {
  try {
    const cfg = await getConfig();
    await openInExplorer(cfg.download_folder);
  } catch (err) {
    toast.error(`打开文件夹失败：${String(err)}`, { duration: 6000 });
  }
}

/**
 * 收书提示用 toast.custom 自绘（同 App 里的「下载完成」提示），不走内置 ToastBar：
 * 内置消息容器是 `flex: 1 1 auto` 且无 min-width:0，长书名会把按钮挤出屏幕。样式见 wireless-transfer.css。
 */
function showFilesToast(names: string[]) {
  const title = names.length === 1 ? "收到来自手机的书" : `收到来自手机的 ${names.length} 本书`;
  const subtitle = names.map((n) => `《${n}》`).join("、");
  toast.custom(
    (t) => (
      <div className={`lan-toast ${t.visible ? "" : "lan-toast-leave"}`}>
        <div className="lan-toast-icon">
          <Inbox size={18} />
        </div>
        <div className="lan-toast-text">
          <div className="lan-toast-title">{title}</div>
          <div className="lan-toast-subtitle" title={names.join("\n")}>
            {subtitle}
          </div>
        </div>
        <button
          className="btn btn-secondary btn-sm lan-toast-action"
          onClick={() => {
            toast.dismiss(t.id);
            openDownloadFolder();
          }}
        >
          <FolderOpen size={13} /> 打开文件夹
        </button>
      </div>
    ),
    { duration: 6000 },
  );
}

/**
 * 无线传书收件提示：监听后端 lan://* 事件 → 合并提示 → 派发窗口事件让书架 / 收藏页刷新。
 * 全局挂载一次（App 根部），与当前所在页面无关。
 */
export default function LanReceiveNotifier() {
  useEffect(() => {
    let pending: string[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const names = pending;
      pending = [];
      if (names.length === 0) return;
      showFilesToast(names);
      playDownloadSound();
      notifyRefresh("files");
    };

    const unFile = listen<LanFileReceived>(LAN_FILE_RECEIVED, (e) => {
      pending.push(e.payload.name);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, MERGE_WINDOW_MS);
    });

    const unBooklist = listen<LanBooklistReceived>(LAN_BOOKLIST_RECEIVED, (e) => {
      const { imported, skipped } = e.payload;
      toast.success(
        skipped > 0
          ? `收到来自手机的书单：新增 ${imported} 本收藏，${skipped} 本已在收藏中`
          : `收到来自手机的书单：新增 ${imported} 本收藏`,
        { icon: "📚", duration: 5000 },
      );
      notifyRefresh("booklist");
    });

    return () => {
      if (timer) clearTimeout(timer);
      unFile.then((f) => f()).catch(warnIgnored("unlisten lan file"));
      unBooklist.then((f) => f()).catch(warnIgnored("unlisten lan booklist"));
    };
  }, []);

  return null;
}
