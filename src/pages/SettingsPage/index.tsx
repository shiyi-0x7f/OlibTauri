import { useState, useEffect } from "react";
import type { AppConfig, CacheStats, HostLatency, HostsInfo } from "./types";
import {
  getConfig,
  setConfig as apiSetConfig,
  getHostsInfo,
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
import SettingsNotices from "./SettingsNotices";

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

      {/* 分区按使用频率由高到低排列：节点 → 下载 → 快捷键 → 其余 → 关于。
          两列网格，阅读顺序先左后右；下载（项多）右侧叠放快捷键 + 外观以对齐高度；
          社群专线（仅社群版）整行，放在半宽配对之间以免打乱配对 */}
      <div className="settings-grid">
        <SettingsNotices />
        <ServerNodesSection
          config={config}
          update={update}
          hostLatencies={hostLatencies}
          pinging={pinging}
          pingHosts={pingHosts}
          hasActiveDownloads={hasActiveDownloads}
          hostsInfo={hostsInfo}
          autoSelecting={autoSelecting}
          onAutoSelect={handleAutoSelect}
        />
        <DownloadSection config={config} update={update} />
        <div className="settings-stack">
          <ShortcutSection config={config} update={update} loadConfig={loadConfig} />
          <AppearanceSection config={config} update={update} />
        </div>
        <GeneralSection
          config={config}
          update={update}
          cacheStats={cacheStats}
          clearing={clearing}
          onClearCache={handleClearCache}
        />
        <AboutSection />
      </div>
    </div>
  );
}
