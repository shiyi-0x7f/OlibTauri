import { useState, useEffect, useCallback, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { detectConvertEngine } from "../../api/convert";
import {
  listPlugins,
  listPluginActions,
  getPluginTasks,
  getPluginOutputs,
  type PluginTask,
  type PluginActionInfo,
  type PluginOutput,
} from "../../api/plugin";
import type { FileInfo } from "../../api/bookshelf";

/** 一个「已 OCR / 已转 MOBI / 瘦身优化生成」之类的标记 */
export interface ProcessMark {
  label: string;
  title: string;
  /** done = 这个文件被加工过；derived = 这个文件是加工产物 */
  tone: "done" | "derived";
}

/**
 * 书架上的插件加工状态：进行中的任务、持久化的加工记录（标记）、可用的动作与支持的输入格式。
 * 任务结束时回调 onTaskFinished（书架据此刷新文件列表，新产物才会出现）。
 */
export function usePluginProcessing(onTaskFinished: () => void) {
  const [tasks, setTasks] = useState<PluginTask[]>([]);
  const [outputs, setOutputs] = useState<PluginOutput[]>([]);
  const [actions, setActions] = useState<PluginActionInfo[]>([]);
  const [convertibleInputs, setConvertibleInputs] = useState<Set<string>>(new Set());
  const [ocrInputs, setOcrInputs] = useState<Set<string>>(new Set());
  const [ocrPluginId, setOcrPluginId] = useState("");

  const refreshTasks = useCallback(async () => {
    try {
      const [t, o] = await Promise.all([getPluginTasks(), getPluginOutputs()]);
      setTasks(t);
      setOutputs(o);
    } catch (err) {
      console.error("Failed to fetch plugin tasks:", err);
    }
  }, []);

  // 挂载时恢复进行中的任务，并从插件清单取各能力支持的输入格式
  // （格式列表与插件是否已安装无关——否则未安装时右键菜单不显示入口，用户无从发现功能）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时拉取后端状态
    refreshTasks();
    detectConvertEngine()
      .then((info) => setConvertibleInputs(new Set(info.inputs.map((i) => i.toUpperCase()))))
      .catch((err) => console.error("Failed to detect convert engine:", err));
    listPlugins()
      .then((list) => {
        const ocr = list.find((p) => p.capability === "ocr");
        setOcrInputs(new Set((ocr?.inputs ?? []).map((i) => i.toUpperCase())));
        setOcrPluginId(ocr?.id ?? "");
      })
      .catch((err) => console.error("Failed to list plugins:", err));
    listPluginActions()
      .then(setActions)
      .catch((err) => console.error("Failed to list plugin actions:", err));
  }, [refreshTasks]);

  // 任务结束（成功/失败）后刷新任务状态与文件列表
  useEffect(() => {
    const unlisten = listen("plugin-task", () => {
      onTaskFinished();
      refreshTasks();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [onTaskFinished, refreshTasks]);

  // 有任务运行中时每秒轮询进度
  const hasRunning = tasks.some((t) => t.status === "Running");
  useEffect(() => {
    if (!hasRunning) return;
    const interval = setInterval(refreshTasks, 1000);
    return () => clearInterval(interval);
  }, [hasRunning, refreshTasks]);

  /** 输入文件路径 → 运行中的任务 */
  const runningByPath = useMemo(() => {
    const map = new Map<string, PluginTask>();
    for (const t of tasks) {
      if (t.status === "Running") map.set(t.input_path, t);
    }
    return map;
  }, [tasks]);

  /**
   * 动作产物在任务记录里把动作 id 存进了 target_format（转换任务存的是目标格式，
   * 清单校验保证两者不重名）。这里回查动作——查得到就说明它是动作产物。
   */
  const actionOf = useCallback(
    (pluginId: string, targetFormat: string | null) =>
      actions.find((a) => a.plugin_id === pluginId && a.action_id === targetFormat),
    [actions],
  );

  /** 加工记录的两个视角：这个文件被加工过（源） / 这个文件是加工产物 */
  const outputIndex = useMemo(() => {
    const asSource = new Map<string, PluginOutput[]>();
    const asOutput = new Map<string, PluginOutput>();
    for (const o of outputs) {
      asOutput.set(o.output_path, o);
      const list = asSource.get(o.source_path) ?? [];
      list.push(o);
      asSource.set(o.source_path, list);
    }
    return { asSource, asOutput };
  }, [outputs]);

  const isOcred = useCallback(
    (file: FileInfo) =>
      (outputIndex.asSource.get(file.path) ?? []).some((o) => o.capability === "ocr"),
    [outputIndex],
  );

  /** 「已 OCR / 已转 MOBI / 已瘦身优化 / OCR 生成」这类标记 */
  const marksOf = useCallback(
    (file: FileInfo): ProcessMark[] => {
      const produced = outputIndex.asSource.get(file.path) ?? [];
      const from = outputIndex.asOutput.get(file.path);
      const marks: ProcessMark[] = [];

      // 这个文件被加工过 —— 提醒用户「这本你处理过了」
      const ocred = produced.filter((o) => o.capability === "ocr");
      if (ocred.length) {
        marks.push({
          label: "已 OCR",
          title: `已识别，生成了 ${ocred.map((o) => o.output_name).join("、")}`,
          tone: "done",
        });
      }
      // 格式转换：capability 为 convert 且不是该插件的某个动作
      const converted = produced.filter(
        (o) => o.capability === "convert" && !actionOf(o.plugin_id, o.target_format),
      );
      if (converted.length) {
        const fmts = [
          ...new Set(converted.map((o) => (o.target_format ?? "").toUpperCase())),
        ].filter(Boolean);
        marks.push({
          label: fmts.length ? `已转 ${fmts.join("/")}` : "已转换",
          title: `已转换，生成了 ${converted.map((o) => o.output_name).join("、")}`,
          tone: "done",
        });
      }
      // 动作（瘦身、解锁、修复…）：每种动作一个标记
      for (const o of produced) {
        const action = actionOf(o.plugin_id, o.target_format);
        if (!action || marks.some((m) => m.label === `已${action.name}`)) continue;
        marks.push({
          label: `已${action.name}`,
          title: `${action.plugin_name} · ${action.name}，生成了 ${o.output_name}`,
          tone: "done",
        });
      }

      // 这个文件本身是加工产物 —— 说清它从哪来的
      if (from) {
        const action = actionOf(from.plugin_id, from.target_format);
        marks.push({
          label: action
            ? `${action.name}生成`
            : from.capability === "ocr"
              ? "OCR 生成"
              : "转换生成",
          title: `源文件：${from.source_name}`,
          tone: "derived",
        });
      }
      return marks;
    },
    [outputIndex, actionOf],
  );

  /** 运行中任务的显示文字：「OCR 识别中 / 瘦身优化中 / 转换为 EPUB」 */
  const taskLabel = useCallback(
    (task: PluginTask) => {
      if (ocrPluginId && task.plugin_id === ocrPluginId) return "OCR 识别中";
      const action = actionOf(task.plugin_id, task.target_format);
      return action ? `${action.name}中` : `转换为 ${task.target_format.toUpperCase()}`;
    },
    [ocrPluginId, actionOf],
  );

  return {
    actions,
    convertibleInputs,
    ocrInputs,
    runningByPath,
    isOcred,
    marksOf,
    taskLabel,
    refreshTasks,
  };
}
