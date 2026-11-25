import { useCallback, useEffect, useRef, useState } from "react";
import { Compass, Loader2, Shuffle } from "lucide-react";
import WereadBookCard from "../../components/WereadBookCard";
import SectionTitle, { SectionError } from "./SectionTitle";
import { wereadRecommendNext, type WereadRecommendBatch } from "../../api/weread";
import { useHorizontalWheel } from "./useHorizontalWheel";

const BATCH_SIZE = 6;

interface Props {
  onOpenBook: (bookId: string) => void;
  /** 页面刷新版本号：变化时重建推荐池（书架可能变了） */
  version: number;
}

/** 为你推荐：以书架最近在读为种子的相似书，单行横排，「换一批」从推荐池取下一批 */
export default function WereadRecommendSection({ onOpenBook, version }: Props) {
  const [batch, setBatch] = useState<WereadRecommendBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 丢弃过期响应（快速连点「换一批」时只认最后一次）
  const requestId = useRef(0);
  const scrollRef = useHorizontalWheel((batch?.books.length ?? 0) > 0);

  const load = useCallback(async (refresh: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const next = await wereadRecommendNext(BATCH_SIZE, refresh);
      if (id === requestId.current) setBatch(next);
    } catch (err) {
      if (id === requestId.current) setError(String(err ?? "加载失败"));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load, version]);

  const books = batch?.books ?? [];

  let body;
  if (error && !batch) {
    body = <SectionError message={`推荐加载失败：${error}`} onRetry={() => load(true)} />;
  } else if (loading && !batch) {
    body = (
      <div className="wr-hscroll">
        {Array.from({ length: BATCH_SIZE }, (_, i) => (
          <div
            key={i}
            className="wr-skeleton"
            style={{ flex: "0 0 112px", height: 200, borderRadius: 10 }}
          />
        ))}
      </div>
    );
  } else if (books.length === 0) {
    body = (
      <div className="wr-muted">
        {batch?.hasSeeds === false
          ? "书架里还没有书，先在微信读书读几本，这里会推荐相似的书"
          : "暂时没有找到相似的书"}
      </div>
    );
  } else {
    body = (
      <>
        {error && <SectionError message={`换一批失败：${error}`} onRetry={() => load(false)} />}
        <div
          className="wr-hscroll"
          ref={scrollRef}
          tabIndex={0}
          aria-label="为你推荐书籍"
          style={{ opacity: loading ? 0.5 : 1, transition: "opacity 0.15s ease" }}
        >
          {books.map((b) => (
            <div key={b.bookId} style={{ flex: "0 0 112px", width: 112 }}>
              <WereadBookCard
                title={b.title}
                cover={b.cover}
                subtitle={b.reason || b.author}
                onClick={() => onOpenBook(b.bookId)}
              />
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <section>
      <SectionTitle
        icon={<Compass size={18} />}
        title="为你推荐"
        sub={batch?.wrapped ? "新推荐已看完，从头再看一遍" : "与你最近在读的书相似"}
        trailing={
          <button
            className="wr-link-btn"
            onClick={() => load(false)}
            disabled={loading || books.length === 0}
          >
            {loading && batch ? <Loader2 size={13} className="spin" /> : <Shuffle size={13} />}
            换一批
          </button>
        }
      />
      {body}
    </section>
  );
}
