import WereadCover from "./WereadCover";

interface Props {
  title: string;
  cover?: string;
  /** 第二行：推荐理由或作者 */
  subtitle?: string;
  onClick: () => void;
}

/** 微信读书书籍卡片（推荐 / 相似书共用）：封面样式与书架一致（.wr-cover） */
export default function WereadBookCard({ title, cover, subtitle, onClick }: Props) {
  return (
    <button type="button" className="wr-shelf-item" style={{ width: "100%" }} onClick={onClick}>
      <WereadCover src={cover} title={title} style={{ width: "100%" }} />
      <div className="wr-shelf-title" title={title}>
        {title}
      </div>
      {subtitle && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            lineHeight: 1.4,
            color: "var(--text-secondary)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {subtitle}
        </div>
      )}
    </button>
  );
}
