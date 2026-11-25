import type { WidgetState } from "../useWidget";
import type { SourceId } from "../model";
import { useAntigravity } from "./useAntigravity";
import { useWorkbuddy } from "./useWorkbuddy";
/** Coordinate source selection and refresh while each provider retains its own data and errors. */
export function useSources(w: WidgetState) {
  const { preferences, snapshot } = w;
  const workbuddy = useWorkbuddy(w.ready, w.demo, preferences, w.lifecycle);
  const antigravity = useAntigravity(w.ready, w.demo, preferences, w.lifecycle);
  const isAntigravity = preferences.selectedSource === "antigravity";
  const isWorkbuddy = preferences.selectedSource === "workbuddy";
  const allSources = preferences.compactView === "all";
  const lastUpdate = snapshot
    ? new Date(snapshot.fetchedAt * 1000).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "尚未更新";
  const codexStatus = preferences.codexEnabled
    ? (w.error ??
      (!w.fresh && snapshot && !w.busy
        ? `上次数据 ${lastUpdate}，等待刷新`
        : null))
    : null;
  const workbuddyStatus =
    preferences.workbuddyEnabled && workbuddy.error
      ? `WorkBuddy · ${workbuddy.error}`
      : null;
  const antigravityStatus =
    preferences.antigravityEnabled && antigravity.error
      ? antigravity.error
      : null;
  /** Refresh each enabled provider without coupling their failure states. */
  async function refreshAll() {
    await Promise.all([
      w.refresh(),
      workbuddy.refresh(),
      antigravity.refresh(),
    ]);
  }
  /** Source selection changes only the view, and can optionally open its details. */
  function selectSource(selectedSource: SourceId, expand = false) {
    void w.update({ selectedSource, ...(expand ? { compact: false } : {}) });
  }
  /** Persist the mini overview preference and the selected detail source together. */
  function miniView(value: "all" | SourceId) {
    void w.update(
      value === "all"
        ? { compactView: "all" }
        : { compactView: "current", selectedSource: value },
    );
  }
  /** Aggregate visible errors into the one reserved mini status line. */
  function status(compact: boolean) {
    if (w.settings) return w.error;
    if (compact && allSources)
      return (
        [
          codexStatus && `Codex · ${codexStatus}`,
          workbuddyStatus,
          antigravityStatus,
        ]
          .filter(Boolean)
          .join("；") || null
      );
    return isAntigravity
      ? antigravityStatus
      : isWorkbuddy
        ? workbuddyStatus
        : codexStatus;
  }
  return {
    workbuddy,
    antigravity,
    isAntigravity,
    isWorkbuddy,
    allSources,
    lastUpdate,
    codexStatus,
    refreshAll,
    selectSource,
    miniView,
    status,
  };
}
export type SourceState = ReturnType<typeof useSources>;
