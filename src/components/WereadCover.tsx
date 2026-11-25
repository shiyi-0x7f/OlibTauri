import { useState, type CSSProperties, type ReactNode } from "react";
import { BookOpen } from "lucide-react";

interface Props {
  src?: string;
  title: string;
  width?: number;
  style?: CSSProperties;
  onClick?: () => void;
  children?: ReactNode;
}

/** 微信读书封面：统一 3:4.2 比例与书脊阴影（样式见 weread-page.css .wr-cover），加载失败显示书名占位 */
export default function WereadCover({ src, title, width, style, onClick, children }: Props) {
  const [broken, setBroken] = useState(false);
  return (
    <div
      className="wr-cover"
      style={{ ...(width ? { width } : null), ...style }}
      onClick={onClick}
      title={onClick ? title : undefined}
    >
      {src && !broken ? (
        <img src={src} alt={title} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <div className="wr-cover-fallback">
          <BookOpen size={16} style={{ opacity: 0.5 }} />
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
