/** 单选按钮组（选项少时比下拉框高效）；样式见 components.css 的 config-dialog-choices */
export default function ChoiceGroup<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="config-dialog-choices" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`btn btn-sm ${value === o.value ? "btn-primary" : "btn-secondary"}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
