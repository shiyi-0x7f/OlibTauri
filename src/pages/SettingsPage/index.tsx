import { useState, useEffect } from "react";
import { RotateCcw } from "lucide-react";
import type { AppConfig, CacheStats, HostLatency, HostsInfo } from "./types";
import {
  getConfig,
  setConfig as apiSetConfig,
  getHostsInfo,
  updateSubscription,
  importHosts,
  resetHosts,
  autoSelectFastestHost,
  pingHosts as apiPingHosts,
} from "../../api/config";
import { getCacheStats, clearCoverCache } from "../../api/cover";
import { getAllDownloads } from "../../api/download";
import AppearanceSection from "./AppearanceSection";
import DownloadSection from "./DownloadSection";
import GeneralSection from "./GeneralSection";
import ShortcutSection from "./ShortcutSection";
import ServerNodesSection from "./ServerNodesSection";
import AboutSection from "./AboutSection";
import WereadSection from "./WereadSection";

// Cache ping results across page navigations (only ping once per session)
let cachedLatencies: HostLatency[] | null = null;

export default function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [hostLatencies, setHostLatencies] = useState<HostLatency[]>(cachedLatencies || []);
  const [pinging, setPinging] = useState(false);
  const [cacheStats, setCacheStats] = useState<CacheStats>({ total_size: 0, file_count: 0 });
  const [clearing, setClearing] = useState(false);
  const [hasActiveDownloads, setHasActiveDownloads] = useState(false);
  const [hostsInfo, setHostsInfo] = useState<HostsInfo | null>(null);
  const [subUrl, setSubUrl] = useState("");
  const [updatingSub, setUpdatingSub] = useState(false);
  const [autoSelecting, setAutoSelecting] = useState(false);

  useEffect(() => {
    loadConfig();
    if (!cachedLatencies) {
      pingHosts();
    }
    loadCacheStats();
    checkActiveDownloads();
    loadHostsInfo();
  }, []);

  const checkActiveDownloads = async () => {
    try {
      const downloads = await getAllDownloads();
      setHasActiveDownloads(downloads.some((d) => d.status === "Downloading"));
    } catch (err) {
      console.error("Failed to check downloads:", err);
    }
  };

  const loadConfig = async () => {
    try {
      const cfg = await getConfig();
      setConfig(cfg);
      setSubUrl(cfg.subscription_url || "");
    } catch (err) {
      console.error("Failed to load config:", err);
    }
  };

  const loadHostsInfo = async () => {
    try {
      const info = await getHostsInfo();
      setHostsInfo(info);
    } catch (err) {
      console.error("Failed to load hosts info:", err);
    }
  };

  const handleUpdateSubscription = async () => {
    if (!subUrl.trim()) return;
    setUpdatingSub(true);
    try {
      const count = await updateSubscription(subUrl.trim());
      await loadConfig();
      await loadHostsInfo();
      pingHosts();
      alert(`订阅更新成功，共 ${count} 个节点`);
    } catch (err) {
      alert(`订阅更新失败: ${err}`);
    }
    setUpdatingSub(false);
  };

  const handleImportHosts = async (text: string) => {
    if (!text) return;
    try {
      const count = await importHosts(text);
      await loadConfig();
      await loadHostsInfo();
      pingHosts();
      alert(`导入成功，共 ${count} 个节点`);
    } catch (err) {
      alert(`导入失败: ${err}`);
    }
  };

  const handleResetHosts = async () => {
    try {
      const count = await resetHosts();
      setSubUrl("");
      await loadConfig();
      await loadHostsInfo();
      pingHosts();
      alert(`已重置为默认 ${count} 个节点`);
    } catch (err) {
      alert(`重置失败: ${err}`);
    }
  };

  const handleAutoSelect = async () => {
    setAutoSelecting(true);
    try {
      await autoSelectFastestHost();
      await loadConfig();
      pingHosts();
    } catch (err) {
      alert(`自动选择失败: ${err}`);
    }
    setAutoSelecting(false);
  };

  const saveConfigToBackend = async (newConfig: AppConfig) => {
    try {
      await apiSetConfig(newConfig);
    } catch (err) {
      console.error("Failed to save config:", err);
    }
  };

  const pingHosts = async () => {
    setPinging(true);
    try {
      const results = await apiPingHosts();
      setHostLatencies(results);
      cachedLatencies = results;
    } catch (err) {
      console.error("Failed to ping hosts:", err);
    }
    setPinging(false);
  };

  const loadCacheStats = async () => {
    try {
      const stats = await getCacheStats();
      setCacheStats(stats);
    } catch (err) {
      console.error("Failed to load cache stats:", err);
    }
  };

  const handleClearCache = async () => {
    setClearing(true);
    try {
      await clearCoverCache();
      setCacheStats({ total_size: 0, file_count: 0 });
    } catch (err) {
      console.error("Failed to clear cache:", err);
    }
    setClearing(false);
  };

  const update = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    if (!config) return;
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    saveConfigToBackend(newConfig);
  };

  if (!config) {
    return (
      <div className="page-container">
        <div className="empty-state">加载中...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">
            设置
          </h1>
          <p className="page-subtitle">自定义应用行为和外观 · 修改后自动保存</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={loadConfig}>
            <RotateCcw size={14} /> 重置
          </button>
        </div>
      </div>

      <div className="settings-grid">
        <AppearanceSection config={config} update={update} />
        <DownloadSection config={config} update={update} />
        <GeneralSection
          config={config}
          update={update}
          cacheStats={cacheStats}
          clearing={clearing}
          onClearCache={handleClearCache}
        />
        <ShortcutSection config={config} update={update} loadConfig={loadConfig} />
        <WereadSection />
        <ServerNodesSection
          config={config}
          update={update}
          hostLatencies={hostLatencies}
          pinging={pinging}
          pingHosts={pingHosts}
          hasActiveDownloads={hasActiveDownloads}
          hostsInfo={hostsInfo}
          subUrl={subUrl}
          setSubUrl={setSubUrl}
          updatingSub={updatingSub}
          autoSelecting={autoSelecting}
          onUpdateSubscription={handleUpdateSubscription}
          onImportHosts={handleImportHosts}
          onResetHosts={handleResetHosts}
          onAutoSelect={handleAutoSelect}
        />
        <AboutSection />
      </div>
    </div>
  );
}
