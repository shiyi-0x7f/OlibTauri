import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  title: string;
  sub?: ReactNode;
  trailing?: ReactNode;
}

export default function SectionTitle({ icon, title, sub, trailing }: Props) {
  return (
    <div className="wr-section-title">
      {icon}
      {title}
      {sub && <span className="wr-section-sub">{sub}</span>}
      {trailing && <div className="wr-section-trailing">{trailing}</div>}
    </div>
  );
}

export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="wr-error">
      <span>{message}</span>
      <button className="wr-link-btn" onClick={onRetry}>
        重试
      </button>
    </div>
  );
}
