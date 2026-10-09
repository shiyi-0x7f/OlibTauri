import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { confirm } from "@tauri-apps/plugin-dialog";
import { FolderOpen, History, RefreshCw, SearchX, Wifi, WifiOff } from "lucide-react";
import toast from "react-hot-toast";
import ContextMenu from "../../components/ContextMenu";
import WirelessTransfer from "../../components/WirelessTransfer";
import ConvertDialog from "../../components/ConvertDialog";
import DownloadQueue from "../../components/DownloadQueue";
import { useWereadImport } from "../../hooks/useWereadImport";
import {
  listFiles,
  deleteFile,
  openFile,
  openInExplorer,
  type FileInfo,
} from "../../api/bookshelf";
import { getLanStatus } from "../../api/lan";
import { ocrAvailable, ocrDocument } from "../../api/ocr";
import { runPluginAction, type PluginActionInfo } from "../../api/plugin";
import BookshelfToolbar, { BookshelfSearch } from "./BookshelfToolbar";
import FileRow from "./FileRow";
import ListHeader from "./ListHeader";
import { buildFileMenu } from "./fileMenu";
import { formatSize } from "./fileKinds";
import { useFileFilter } from "./useFileFilter";
import { usePluginProcessing } from "./usePluginProcessing";

/** 执行一个文件操作，失败时提示用户（不静默吞错） */
async function run(what: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error(`${what} failed:`, err);
    toast.error(`${what}失败：${String(err)}`, { duration: 6000 });
  }
}

export default function BookshelfPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number; file: FileInfo } | null>(null);
  const [showWireless, setShowWireless] = useState(false);
  const [lanRunning, setLanRunning] = useState(false);
  const [convertFile, setConvertFile] = useState<FileInfo | null>(null);
  const { importBook: importToWeread, importing: wereadImporting } = useWereadImport();

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      setFiles(await listFiles(null));
    } catch (err) {
      console.error("Failed to load files:", err);
      toast.error(`读取下载文件夹失败：${String(err)}`, { duration: 6000 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时读取下载文件夹
    loadFiles();
  }, [loadFiles]);

  // 无线传书状态（按钮显示「传书中」）
  useEffect(() => {
    const check = () =>
      getLanStatus()
        .then((s) => setLanRunning(s.running))
        .catch((err) => console.error("Failed to get LAN status:", err));
    check();
    const interval = setInterval(check, 3000);
    return () => clearInterval(interval);
  }, []);

  const filter = useFileFilter(files);
  const processing = usePluginProcessing(loadFiles);

  const stats = useMemo(() => {
    const docs = files.filter((f) => !f.is_dir);
    return { count: docs.length, bytes: docs.reduce((sum, f) => sum + f.size, 0) };
  }, [files]);

  // ---------- 文件操作 ----------

  const handleOpen = useCallback(
    (file: FileInfo) => run("打开文件", () => openFile(file.path)),
    [],
  );
  const handleReveal = useCallback(
    (file: FileInfo) => run("打开文件夹", () => openInExplorer(file.path)),
    [],
  );
  const handleMenu = useCallback(
    (file: FileInfo, x: number, y: number) => setMenu({ x, y, file }),
    [],
  );
  const closeMenu = useCallback(() => setMenu(null), []);

  const handleDelete = async (file: FileInfo) => {
    const confirmed = await confirm(`确定要删除「${file.name}」吗？`, {
      title: "删除确认",
      kind: "warning",
      okLabel: "删除",
      cancelLabel: "取消",
    });
    if (!confirmed) return;
    await run("删除", async () => {
      await deleteFile(file.path);
      await loadFiles();
    });
  };

  const handleOcr = (file: FileInfo) =>
    run("启动 OCR", async () => {
      if (!(await ocrAvailable())) {
        toast("需要先安装「OCR 文字识别」插件", { icon: "🧩", duration: 4000 });
        navigate("/plugins");
        return;
      }
      await ocrDocument(file.path);
      toast("已开始识别，完成后会生成可搜索的 PDF", { icon: "🔍", duration: 4000 });
      processing.refreshTasks();
    });

  const handleAction = (file: FileInfo, action: PluginActionInfo) => {
    if (!action.installed) {
      toast(`需要先安装「${action.plugin_name}」插件`, { icon: "🧩", duration: 4000 });
      navigate("/plugins");
      return;
    }
    run(action.name, async () => {
      await runPluginAction({
        pluginId: action.plugin_id,
        actionId: action.action_id,
        inputPath: file.path,
      });
      toast(`已开始${action.name}`, { icon: "🪄", duration: 3000 });
      processing.refreshTasks();
    });
  };

  const menuItems = (file: FileInfo) => {
    const ext = file.extension.toUpperCase();
    return buildFileMenu(file, {
      busy: processing.runningByPath.has(file.path),
      convertible: processing.convertibleInputs.has(ext),
      ocrSupported: processing.ocrInputs.has(ext),
      alreadyOcred: processing.isOcred(file),
      wereadUploading: wereadImporting.has(file.path),
      actions: processing.actions,
      onOpen: () => handleOpen(file),
      onReveal: () => handleReveal(file),
      onConvert: () => setConvertFile(file),
      onOcr: () => handleOcr(file),
      onImportWeread: () => importToWeread(file.path),
      onAction: (action) => handleAction(file, action),
      onDelete: () => handleDelete(file),
    });
  };

  // ---------- 渲染 ----------

  const renderList = () => {
    if (loading && files.length === 0) {
      return (
        <div className="empty-state">
          <RefreshCw size={24} className="spinner" />
        </div>
      );
    }
    if (files.length === 0) {
      return (
        <div className="empty-state">
          <FolderOpen size={40} className="empty-state-icon" />
          <p className="empty-state-text">下载文件夹还是空的</p>
          <p className="empty-state-hint">在「搜索」或「发现」里下载书籍后，会出现在这里</p>
        </div>
      );
    }
    if (filter.visibleFiles.length === 0) {
      return (
        <div className="empty-state">
          <SearchX size={40} className="empty-state-icon" />
          <p className="empty-state-text">没有匹配的文件</p>
          {filter.query && (
            <button className="btn btn-secondary btn-sm" onClick={() => filter.setQuery("")}>
              清空搜索
            </button>
          )}
        </div>
      );
    }
    return filter.visibleFiles.map((file) => {
      const task = processing.runningByPath.get(file.path);
      return (
        <FileRow
          key={file.path}
          file={file}
          task={task}
          taskLabel={task && processing.taskLabel(task)}
          marks={processing.marksOf(file)}
          onOpen={handleOpen}
          onReveal={handleReveal}
          onMenu={handleMenu}
        />
      );
    });
  };

  return (
    <div className="page-container bs-page">
      <div className="bs-header">
        <div className="bs-title">
          <h1>书架</h1>
          {stats.count > 0 && (
            <span>
              {stats.count} 个文件 · {formatSize(stats.bytes)}
            </span>
          )}
        </div>
        <div className="flex gap-2 items-center">
          {files.length > 0 && (
            <BookshelfSearch query={filter.query} onQueryChange={filter.setQuery} />
          )}
          <button
            className={`btn btn-sm ${lanRunning ? "btn-wireless-active" : "btn-secondary"}`}
            onClick={() => setShowWireless(true)}
          >
            {lanRunning ? (
              <>
                <span className="wireless-dot" />
                <Wifi size={14} /> 传书中
              </>
            ) : (
              <>
                <WifiOff size={14} /> 无线传书
              </>
            )}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate("/history")}>
            <History size={14} /> 下载历史
          </button>
          <button
            className="btn btn-secondary btn-icon btn-sm"
            onClick={loadFiles}
            title="刷新"
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "spinner" : ""} />
          </button>
        </div>
      </div>

      {files.length > 0 && (
        <BookshelfToolbar
          categoryOptions={filter.categoryOptions}
          activeCategory={filter.activeCategory}
          onCategorySelect={filter.selectCategory}
          subFormatOptions={filter.subFormatOptions}
          activeSubFormat={filter.activeSubFormat}
          onSubFormatSelect={filter.setSubFormat}
        />
      )}

      <div className="card bs-list">
        {filter.visibleFiles.length > 0 && (
          <ListHeader
            sort={filter.sort}
            onSortChange={filter.setSort}
            count={filter.visibleFiles.length}
          />
        )}
        <div className="bs-rows">{renderList()}</div>
      </div>

      <DownloadQueue onCompleted={loadFiles} />

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.file)} onClose={closeMenu} />
      )}
      {showWireless && <WirelessTransfer onClose={() => setShowWireless(false)} />}
      {convertFile && (
        <ConvertDialog
          fileName={convertFile.name}
          filePath={convertFile.path}
          extension={convertFile.extension}
          onClose={() => setConvertFile(null)}
          onStarted={processing.refreshTasks}
        />
      )}
    </div>
  );
}
