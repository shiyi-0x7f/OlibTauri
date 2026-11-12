import { useState, useEffect } from "react";
import { Bot, Check, ChevronDown, Copy, FolderOpen } from "lucide-react";
import toast from "react-hot-toast";
import { exportPluginGuide, openPluginGuideFolder, type PluginGuide } from "../../api/plugin";

/** 复制给 Agent 的简短指令：完整规范在本机的指南文件里，让 Agent 自己去读 */
function buildPrompt(guide: PluginGuide): string {
  return `请帮我为 Olib（一款 Windows 电子书桌面应用）寻找或编写一个插件。

1. 先完整阅读 Olib 内置的插件开发指南（Markdown 文件，在我这台电脑上）：
   ${guide.guide_path}
   指南里有寻找工具的方法、筛选标准、实测步骤、清单格式与全部校验规则，请严格按它执行，每一步都实际运行命令验证。

2. 我的需求：<在这里写你想要的功能，例如：把 PDF 转成 Word；给 PDF 加页码；压缩漫画 CBZ 的体积>

3. 完成后把插件清单 JSON 保存到下面的目录（文件名用插件 id），并给我一份测试报告：
   ${guide.registries_dir}
   我会在 Olib「插件」页点「刷新」加载它。`;
}

const STEPS = [
  "点「复制指令」，发给你本机的 AI Agent（Claude Code、Codex、Cursor 等），把其中的「我的需求」改成你想要的功能。",
  "Agent 会先读取 Olib 内置的插件开发指南，再去找合适的开源命令行工具、实测并写好插件清单，直接保存到本机的插件源目录。",
  "回到本页点右上角「刷新」，新插件就会出现在列表里；安装后在书架右键对应文件即可使用。",
];

/** 插件页底部：教用户借助本机 AI Agent 寻找 / 编写第三方插件 */
export default function AgentGuide() {
  const [guide, setGuide] = useState<PluginGuide | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // 每次进入插件页都重新生成，保证指南里的内置插件列表、路径与当前状态一致
  useEffect(() => {
    exportPluginGuide()
      .then(setGuide)
      .catch((err) => {
        console.error("Failed to export plugin guide:", err);
        setError(String(err));
      });
  }, []);

  const handleCopy = async () => {
    if (!guide) return;
    try {
      await navigator.clipboard.writeText(buildPrompt(guide));
      setCopied(true);
      toast.success("已复制，粘贴给 AI Agent 即可");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy agent prompt:", err);
      toast.error(`复制失败：${String(err)}`, { duration: 6000 });
    }
  };

  const handleOpenFolder = async () => {
    try {
      await openPluginGuideFolder();
    } catch (err) {
      toast.error(String(err), { duration: 6000 });
    }
  };

  return (
    <div className="card pl-agent">
      <div className="pl-agent-head">
        <div className="pl-icon" style={{ "--pl-tone": "#8b5cf6" } as React.CSSProperties}>
          <Bot size={18} />
        </div>
        <div className="pl-item-main">
          <div className="pl-item-title">让 AI Agent 帮你找插件</div>
          <div className="pl-item-summary">
            想要的功能这里没有？Olib 内置了一份完整的插件开发指南，本机的 AI Agent
            可以直接读取它，按规范帮你找到工具并写好插件。
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleCopy} disabled={!guide}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "已复制" : "复制指令"}
        </button>
      </div>

      <ol className="pl-agent-steps">
        {STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      {error ? (
        <div className="pl-error pl-agent-indent">
          <span>生成插件开发指南失败：{error}</span>
        </div>
      ) : (
        guide && (
          <div className="pl-agent-indent">
            <div className="pl-section-label">指南文件</div>
            <div className="pl-path">{guide.guide_path}</div>
            <div className="pl-btn-row" style={{ marginTop: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={handleOpenFolder}>
                <FolderOpen size={14} /> 打开所在文件夹
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
              >
                <ChevronDown size={14} className={expanded ? "pl-rotated" : ""} />
                {expanded ? "收起指南全文" : "查看指南全文"}
              </button>
            </div>
            {expanded && <pre className="pl-agent-prompt">{guide.content}</pre>}
          </div>
        )
      )}
    </div>
  );
}
