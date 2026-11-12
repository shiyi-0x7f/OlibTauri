import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { warnIgnored } from "../utils/log";

interface Props {
  text: string;
  /** 生成中：末尾显示闪烁光标 */
  streaming?: boolean;
}

const SAFE_LINK = /^https?:\/\//i;

const components: Components = {
  // 链接一律交系统浏览器，避免在应用 WebView 内跳走
  a: ({ href, children }) =>
    href && SAFE_LINK.test(href) ? (
      <a
        href={href}
        title={href}
        onClick={(e) => {
          e.preventDefault();
          openUrl(href).catch(warnIgnored("weread_ai_open_link"));
        }}
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // 不自动加载远程图片，只保留说明文字
  img: ({ alt }) => (alt ? <span>[图片：{alt}]</span> : null),
};

/** 微信读书 AI 回答渲染（GFM：表格 / 删除线 / 任务列表）；默认不渲染原始 HTML */
function WereadMarkdown({ text, streaming }: Props) {
  return (
    <div className={streaming ? "wr-md wr-streaming" : "wr-md"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(WereadMarkdown);
