import { sourceOptions, type Preferences, type SourceId } from "../model";
/** Keep the same visible selector in every mini mode so the overview always remains reachable. */
export function MiniViewPicker({
  preferences,
  onChange,
}: {
  preferences: Preferences;
  onChange: (value: "all" | SourceId) => void;
}) {
  return (
    <select
      className={`mini-view-select ${preferences.antigravityEnabled ? "has-antigravity" : ""}`}
      aria-label="迷你条视图"
      title="切换迷你条视图"
      value={
        preferences.compactView === "all" ? "all" : preferences.selectedSource
      }
      onChange={(e) => onChange(e.target.value as "all" | SourceId)}
    >
      <option value="all">全部来源</option>
      {sourceOptions
        .filter((source) => preferences[source.enabled])
        .map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
    </select>
  );
}
