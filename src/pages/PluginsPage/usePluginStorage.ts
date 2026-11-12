import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import {
  getPluginsLocation,
  getPluginsUsage,
  type PluginsLocation,
  type PluginsUsage,
} from "../../api/plugin";

/** 插件安装位置 + 占用统计。占用随安装 / 卸载 / 迁移变化，跟着已装数量和位置重新统计 */
export function usePluginStorage(installedCount: number) {
  const [location, setLocation] = useState<PluginsLocation | null>(null);
  const [usage, setUsage] = useState<PluginsUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    getPluginsLocation()
      .then(setLocation)
      .catch((err) => {
        console.error("Failed to load plugins location:", err);
        toast.error(`读取插件安装位置失败：${String(err)}`, { duration: 6000 });
      });
  }, []);

  const locationPath = location?.path;
  useEffect(() => {
    if (!locationPath) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 统计期间显示加载态
    setUsageLoading(true);
    getPluginsUsage()
      .then((u) => !cancelled && setUsage(u))
      .catch((err) => console.error("Failed to compute plugins usage:", err))
      .finally(() => !cancelled && setUsageLoading(false));
    return () => {
      cancelled = true;
    };
  }, [locationPath, installedCount]);

  return { location, setLocation, usage, usageLoading };
}
