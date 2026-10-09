import { useState, useEffect, useCallback, useMemo } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Globe, Puzzle, RefreshCw, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import {
  listPlugins,
  listPluginActions,
  installPlugin,
  uninstallPlugin,
  reloadPluginRegistries,
  type PluginStatus,
  type PluginActionInfo,
} from "../../api/plugin";
import { detectConvertEngine, type EngineInfo } from "../../api/convert";
import { getConfig, setConfig } from "../../api/config";
import PluginCard from "./PluginCard";
import StorageOverview from "./StorageOverview";
import AddSourceModal from "./AddSourceModal";
import AgentGuide from "./AgentGuide";
import { usePluginStorage } from "./usePluginStorage";
import { toneAt } from "./format";

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginStatus[]>([]);
  const [actions, setActions] = useState<PluginActionInfo[]>([]);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [calibrePath, setCalibrePath] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAddSource, setShowAddSource] = useState(false);
  // 默认全部收起，只显示一行简略信息
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const refresh = useCallback(async () => {
    try {
      const [list, acts, info, cfg] = await Promise.all([
        listPlugins(),
        listPluginActions(),
        detectConvertEngine(),
        getConfig(),
      ]);
      setPlugins(list);
      setActions(acts);
      setEngine(info);
      setCalibrePath(cfg.calibre_path || "");
    } catch (err) {
      console.error("Failed to load plugins:", err);
      toast.error(`加载插件失败：${String(err)}`, { duration: 6000 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时拉取插件状态
    refresh();
  }, [refresh]);

  // 有插件在下载/安装时轮询进度
  const busy = plugins.some(
    (p) => p.phase === "Downloading" || p.phase === "Verifying" || p.phase === "Installing",
  );
  useEffect(() => {
    if (!busy) return;
    const interval = setInterval(refresh, 800);
    return () => clearInterval(interval);
  }, [busy, refresh]);

  const installedCount = plugins.filter((p) => p.phase === "Installed").length;
  const storage = usePluginStorage(installedCount);

  const toneOf = useMemo(() => {
    const index = new Map(plugins.map((p, i) => [p.id, i]));
    return (id: string) => toneAt(index.get(id) ?? 0);
  }, [plugins]);

  const sizeOf = useMemo(() => {
    const map = new Map(storage.usage?.plugins.map((u) => [u.id, u.bytes]));
    return (id: string) => map.get(id);
  }, [storage.usage]);

  /** 刷新时重新扫描插件源——AI Agent 刚放进本地插件源目录的清单无需重启即可出现 */
  const handleReload = async () => {
    try {
      await reloadPluginRegistries();
    } catch (err) {
      toast.error(`重新加载插件源失败：${String(err)}`, { duration: 6000 });
    }
    refresh();
  };

  const handleInstall = async (id: string) => {
    try {
      await installPlugin(id);
      refresh();
    } catch (err) {
      toast.error(String(err), { duration: 5000 });
    }
  };

  const handleUninstall = async (p: PluginStatus) => {
    const confirmed = await confirm(
      `卸载「${p.name}」后相关功能将不可用，需要时可重新下载。确定卸载吗？`,
      { title: "卸载插件", kind: "warning", okLabel: "卸载", cancelLabel: "取消" },
    );
    if (!confirmed) return;
    try {
      await uninstallPlugin(p.id);
      toast.success(`${p.name} 已卸载`);
      refresh();
    } catch (err) {
      toast.error(String(err), { duration: 5000 });
    }
  };

  const handleSetCalibrePath = async (path: string) => {
    try {
      const cfg = await getConfig();
      await setConfig({ ...cfg, calibre_path: path });
      refresh();
    } catch (err) {
      toast.error(String(err), { duration: 5000 });
    }
  };

  return (
    <div className="page-container">
      <div className="pl-page">
        <div className="page-header flex items-center justify-between">
          <div>
            <h1 className="page-title">插件</h1>
            <p className="page-subtitle">按需安装扩展能力，不用则不占空间</p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAddSource(true)}>
              <Globe size={14} /> 添加插件源
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleReload}>
              <RefreshCw size={14} /> 刷新
            </button>
          </div>
        </div>

        {loading ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <RefreshCw size={24} className="spinner" />
          </div>
        ) : plugins.length === 0 ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <Puzzle size={36} className="empty-state-icon" />
            <p className="empty-state-text">没有可用插件</p>
          </div>
        ) : (
          <>
            <StorageOverview
              location={storage.location}
              onLocationChange={storage.setLocation}
              usage={storage.usage}
              usageLoading={storage.usageLoading}
              installedCount={installedCount}
              totalCount={plugins.length}
              toneOf={toneOf}
              onRelocated={refresh}
            />

            <div className="pl-grid-title">
              全部插件
              <span className="pl-grid-count">{plugins.length}</span>
            </div>
            <div className="pl-list">
              {plugins.map((p) => (
                <PluginCard
                  key={p.id}
                  plugin={p}
                  actions={actions.filter((a) => a.plugin_id === p.id)}
                  engine={engine}
                  calibrePath={calibrePath}
                  tone={toneOf(p.id)}
                  sizeBytes={sizeOf(p.id)}
                  expanded={expandedIds.has(p.id)}
                  onToggle={() => toggleExpanded(p.id)}
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                  onSetCalibrePath={handleSetCalibrePath}
                />
              ))}
            </div>

            <AgentGuide />

            <div className="pl-note">
              <ShieldCheck size={15} />
              <span>
                插件由外部开源工具提供，均为本地运行、不上传文件。第三方插件必须提供 sha256
                校验和，安装前会逐字节校验，与官方发布的安装包不符则拒绝安装。
              </span>
            </div>
          </>
        )}
      </div>

      {showAddSource && (
        <AddSourceModal onAdded={refresh} onClose={() => setShowAddSource(false)} />
      )}
    </div>
  );
}
