import { sourceOptions, type Preferences, type SourceId } from "../model";

type ViewOption = { value: "all" | SourceId; label: string };

/**
 * Custom frosted pill switcher that cycles through overview and enabled sources
 * without spawning a native select menu or overflowing the 104pt mini window.
 */
export function MiniViewPicker({
  preferences,
  onChange,
}: {
  preferences: Preferences;
  onChange: (value: "all" | SourceId) => void;
}) {
  const options: ViewOption[] = [
    { value: "all", label: "全部" },
    ...sourceOptions
      .filter((source) => preferences[source.enabled])
      .map((source) => ({ value: source.id as SourceId, label: source.name })),
  ];
  const currentValue: "all" | SourceId =
    preferences.compactView === "all" ? "all" : preferences.selectedSource;
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === currentValue),
  );
  const current = options[activeIndex] ?? options[0];

  function step(delta: number) {
    if (options.length <= 1) return;
    const next = options[(activeIndex + delta + options.length) % options.length];
    onChange(next.value);
  }

  return (
    <button
      type="button"
      className="mini-view-pill"
      aria-label={`迷你条视图：${current.label}，点击切换`}
      title={`当前：${current.label}（点击切换视图）`}
      onClick={() => step(1)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          step(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          step(-1);
        }
      }}
    >
      <span>{current.label}</span>
      {options.length > 1 && (
        <span className="mini-view-dots" aria-hidden="true">
          {options.map((opt, idx) => (
            <i key={opt.value} className={idx === activeIndex ? "active" : ""} />
          ))}
        </span>
      )}
    </button>
  );
}
