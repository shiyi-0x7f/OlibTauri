import { useEffect, useMemo, useRef, useState } from "react";
import { Library, Loader2, Plus, Shuffle, X } from "lucide-react";
import type { AiInputType } from "./usePrescriber";
import {
  BUILTIN_BOOKS,
  PROMPT_MAX,
  TITLE_MAX,
  loadCustomBooks,
  newCustomBook,
  randomLooks,
  saveCustomBooks,
  type ShelfBook,
} from "./shelfBooks";

/** 抽出书到发起寻书之间的停顿，让「抽出来」这个动作被看见 */
const PULL_MS = 650;
/** 每层书架最多放几本（含末尾的「添加」） */
const PER_SHELF = 10;
const ADD_SLOT = "__add__";

interface Props {
  disabled: boolean;
  onPick: (input: string, inputType: AiInputType) => void;
}

/** AI 寻书入口：书架上一排书，凭感觉抽一本；末尾可以放上自己写的书 */
export default function AiBookshelf({ disabled, onPick }: Props) {

  const [custom, setCustom] = useState<ShelfBook[]>(loadCustomBooks);
  const books = useMemo(() => [...BUILTIN_BOOKS, ...custom], [custom]);
  // 每次进入随机配色；新加的书单独补一份外观，已有的书颜色不跳变
  const [looks, setLooks] = useState(() => randomLooks([...BUILTIN_BOOKS, ...loadCustomBooks()]));
  const [pulled, setPulled] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // 抽书到发问之间若组件已卸载（切走模式），不再发问
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const pull = (book: ShelfBook) => {
    if (disabled || pulled) return;
    setPulled(book.id);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setPulled(null);
      onPick(book.prompt, book.kind);
    }, PULL_MS);
  };

  const addBook = (title: string, prompt: string) => {
    const book = newCustomBook(title, prompt);
    const next = [...custom, book];
    setCustom(next);
    saveCustomBooks(next);
    setLooks((prev) => new Map([...prev, ...randomLooks([book])]));
    setAdding(false);
  };

  const removeBook = (id: string) => {
    const next = custom.filter((b) => b.id !== id);
    setCustom(next);
    saveCustomBooks(next);
  };

  const slots = [...books.map((b) => b.id), ADD_SLOT];
  const shelves: string[][] = [];
  for (let i = 0; i < slots.length; i += PER_SHELF) shelves.push(slots.slice(i, i + PER_SHELF));
  const byId = new Map(books.map((b) => [b.id, b]));

  return (
    <section className="card ai-start">
      <div className="ai-start-head">
        <span className="ai-finder-icon lg">
          <Library size={20} />
        </span>
        <div className="ai-start-heading">
          <div className="ai-start-title">
            从书架上抽一本
          </div>
          <div className="ai-start-sub">
            凭感觉抽一本，AI 按它帮你挑书；也可以在上方直接说说你的状态
          </div>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          disabled={disabled || pulled !== null}
          onClick={() => pull(books[Math.floor(Math.random() * books.length)])}
        >
          <Shuffle size={14} /> 随手抽一本
        </button>
      </div>

      <div className={`ai-shelves ${pulled ? "has-pulled" : ""}`}>
        {shelves.map((row, r) => (
          <div key={r} className="ai-shelf">
            {row.map((id) => {
              if (id === ADD_SLOT) {
                return (
                  <button
                    key={id}
                    className="ai-spine-add"
                    onClick={() => setAdding(true)}
                    title="放一本自己的书：写下书脊文字和想对 AI 说的话"
                  >
                    <Plus size={16} />
                    <span>添加</span>
                  </button>
                );
              }
              const book = byId.get(id)!;
              const look = looks.get(id);
              return (
                <div
                  key={id}
                  className={`ai-spine-wrap ${pulled === id ? "is-pulled" : ""}`}
                  style={
                    {
                      "--spine": look?.color,
                      "--spine-w": `${look?.width ?? 46}px`,
                      "--spine-h": `${look?.height ?? 156}px`,
                    } as React.CSSProperties
                  }
                >
                  <button
                    className="ai-spine"
                    disabled={disabled}
                    onClick={() => pull(book)}
                    aria-label={`${book.title}：${book.tagline}`}
                  >
                    <i />
                    <b className={book.title.length > 4 ? "is-long" : ""}>{book.title}</b>
                    <i />
                  </button>
                  <span className="ai-spine-tip" role="tooltip">
                    {book.tagline}
                  </span>
                  {book.custom && (
                    <button
                      className="ai-spine-remove"
                      title="从书架上拿走这本"
                      onClick={() => removeBook(book.id)}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {adding && <AddBookDialog onSave={addBook} onClose={() => setAdding(false)} />}
    </section>
  );
}

/** 放一本自己的书：书脊文字 + 想对 AI 说的话 */
function AddBookDialog({
  onSave,
  onClose,
}: {
  onSave: (title: string, prompt: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const valid = title.trim().length > 0 && prompt.trim().length > 0;

  const submit = () => {
    if (valid) onSave(title, prompt);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-add-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">放一本自己的书</div>
        <p className="ai-add-desc">
          写下书脊上的字和想对 AI 说的话，以后从书架上抽到它，AI 就按这句话帮你挑书。
        </p>
        <label className="ai-add-field" htmlFor="ai-add-title">
          <span>
            书脊文字
            <em>
              {title.trim().length}/{TITLE_MAX}
            </em>
          </span>
          <input
            id="ai-add-title"
            className="input"
            autoFocus
            maxLength={TITLE_MAX}
            placeholder="例如：考研"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="ai-add-field" htmlFor="ai-add-prompt">
          <span>
            想对 AI 说的话
            <em>
              {prompt.trim().length}/{PROMPT_MAX}
            </em>
          </span>
          <textarea
            id="ai-add-prompt"
            className="input"
            rows={3}
            maxLength={PROMPT_MAX}
            placeholder="例如：准备考研，想找几本提升专注力和学习方法的书"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>
        <div className="ai-add-actions">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary btn-sm" disabled={!valid} onClick={submit}>
            <Plus size={14} /> 放上书架
          </button>
        </div>
      </div>
    </div>
  );
}

/** 寻书中：与书单卡片同形的骨架屏 + 轮换的进度文案 */
export function AiLoading({ line }: { line: string }) {
  return (
    <div className="ai-loading">
      <div className="ai-loading-line">
        <Loader2 size={14} className="spinner" />
        {line}
      </div>
      <div className="ai-books">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ai-book ai-skeleton" aria-hidden>
            <div className="ai-skeleton-cover" />
            <div className="ai-skeleton-body">
              <div className="ai-skeleton-bar" style={{ width: "55%" }} />
              <div className="ai-skeleton-bar sm" style={{ width: "30%" }} />
              <div className="ai-skeleton-bar sm" style={{ width: "92%", marginTop: 14 }} />
              <div className="ai-skeleton-bar sm" style={{ width: "80%" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
