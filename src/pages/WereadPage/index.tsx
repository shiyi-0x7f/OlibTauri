import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  BookOpen,
  Compass,
  Loader2,
  NotebookPen,
  QrCode,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Upload,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useWereadImport } from "../../hooks/useWereadImport";
import WereadBookDetailModal from "../../components/WereadBookDetailModal";
import WereadQrLoginDialog from "../../components/WereadQrLoginDialog";
import ContinueReadingCard from "./ContinueReadingCard";
import ReadingRhythmCard from "./ReadingRhythmCard";
import StatsStrip from "./StatsStrip";
import HighlightCard from "./HighlightCard";
import PreferenceCard from "./PreferenceCard";
import WereadRecommendSection from "./WereadRecommendSection";
import ShelfRow from "./ShelfRow";
import NotebookSection from "./NotebookSection";
import { greeting } from "./format";
import { useLoad } from "./useLoad";
import {
  wereadStatus,
  wereadGetShelf,
  wereadGetStats,
  wereadGetNotebooks,
  wereadReadData,
  WEREAD_IMPORT_EXTENSIONS,
} from "../../api/weread";

const loadShelf = () => wereadGetShelf();
const loadOverall = () => wereadGetStats();
const loadWeekly = () => wereadReadData("weekly");
const loadNotebooks = () => wereadGetNotebooks().then((r) => r.books ?? []);

/**
 * 微信读书页：继续阅读 + 阅读节奏 → 累计数据 → 重温划线 + 阅读偏好 → 推荐 → 书架 → 笔记。
 * 各区块独立加载、独立失败；「刷新」统一重载。
 */
export default function WereadPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  // 各数据源的重载版本号：页面刷新全部 +1，区块重试只 +1 自己
  const [versions, setVersions] = useState({ shelf: 0, overall: 0, weekly: 0, notebooks: 0 });
  const [pageVersion, setPageVersion] = useState(0);

  const checkStatus = useCallback(() => {
    wereadStatus()
      .then((s) => {
        setStatusError("");
        setConnected(s.connected);
      })
      .catch((err) => setStatusError(String(err ?? "读取连接状态失败")));
  }, []);

  useEffect(checkStatus, [checkStatus]);

  const on = connected === true;
  const shelf = useLoad(on ? loadShelf : null, versions.shelf);
  const overall = useLoad(on ? loadOverall : null, versions.overall);
  const weekly = useLoad(on ? loadWeekly : null, versions.weekly);
  const notebooks = useLoad(on ? loadNotebooks : null, versions.notebooks);

  const retry = (key: keyof typeof versions) => () =>
    setVersions((v) => ({ ...v, [key]: v[key] + 1 }));

  const refreshAll = () => {
    setVersions((v) => ({
      shelf: v.shelf + 1,
      overall: v.overall + 1,
      weekly: v.weekly + 1,
      notebooks: v.notebooks + 1,
    }));
    setPageVersion((v) => v + 1);
  };

  const refreshing = shelf.loading || overall.loading || weekly.loading || notebooks.loading;

  const onImported = useCallback(() => {
    setVersions((v) => ({ ...v, shelf: v.shelf + 1 }));
    setPageVersion((v) => v + 1);
  }, []);
  const { importBook, importing } = useWereadImport(onImported);

  const pickAndImport = async () => {
    const picked = await open({
      multiple: true,
      title: "选择要导入微信读书的书（单本 ≤ 200 MB）",
      filters: [{ name: "电子书", extensions: WEREAD_IMPORT_EXTENSIONS }],
    });
    const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
    paths.forEach((p) => void importBook(p));
  };

  if (statusError) {
    return (
      <div className="wr-connect">
        <div className="wr-connect-card">
          <p style={{ color: "var(--error)", userSelect: "text" }}>{statusError}</p>
          <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={checkStatus}>
            重试
          </button>
        </div>
      </div>
    );
  }

  if (connected === null) {
    return (
      <div className="wr-connect">
        <Loader2 className="spin" size={28} style={{ color: "var(--text-secondary)" }} />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="wr-connect">
        <div className="wr-connect-card">
          <BookOpen size={44} style={{ color: "var(--accent)" }} />
          <h2>连接微信读书</h2>
          <p>用手机微信扫码授权后，Olib 会把你的阅读数据整理到这里（原 API Key 方式已停用）。</p>
          <div className="wr-connect-features">
            <div>
              <TrendingUp size={14} /> 阅读节奏与统计
            </div>
            <div>
              <NotebookPen size={14} /> 划线笔记一键导出
            </div>
            <div>
              <Sparkles size={14} /> AI 问书
            </div>
            <div>
              <Compass size={14} /> 相似书推荐
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowQr(true)}>
            <QrCode size={16} /> 扫码连接
          </button>
        </div>
        {showQr && (
          <WereadQrLoginDialog
            onClose={() => setShowQr(false)}
            onConnected={() => {
              setShowQr(false);
              toast.success("微信读书已连接");
              setConnected(true);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="wr-page">
      <div className="wr-page-inner">
        <header className="wr-header">
          <div>
            <h1>微信读书</h1>
            <p>{greeting()}</p>
          </div>
          <div className="wr-header-actions">
            <button
              className="wr-pill-btn"
              onClick={pickAndImport}
              title="把本机的 EPUB / PDF / MOBI / TXT / AZW3 上传到微信读书书架"
            >
              {importing.size > 0 ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}{" "}
              导入本机书
            </button>
            <button className="wr-pill-btn" onClick={refreshAll} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? "spin" : ""} /> 刷新
            </button>
          </div>
        </header>

        <div className="wr-grid-2">
          <ContinueReadingCard
            shelf={shelf}
            onRetry={retry("shelf")}
            onOpenBook={setSelectedBookId}
          />
          <ReadingRhythmCard weekly={weekly} onRetry={retry("weekly")} />
        </div>

        <StatsStrip overall={overall} onRetry={retry("overall")} />

        <div className="wr-grid-2 even">
          <HighlightCard notebooks={notebooks} onOpenBook={setSelectedBookId} />
          <PreferenceCard overall={overall} onRetry={retry("overall")} />
        </div>

        <WereadRecommendSection onOpenBook={setSelectedBookId} version={pageVersion} />

        <ShelfRow shelf={shelf} onOpenBook={setSelectedBookId} />

        <NotebookSection
          notebooks={notebooks}
          onRetry={retry("notebooks")}
          onOpenBook={setSelectedBookId}
        />
      </div>

      {selectedBookId && (
        <WereadBookDetailModal
          bookId={selectedBookId}
          onClose={() => setSelectedBookId(null)}
          onOpenBook={setSelectedBookId}
        />
      )}
    </div>
  );
}
