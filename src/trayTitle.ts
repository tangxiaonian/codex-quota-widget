import { miniGroups, tightestQuota, type AntigravitySnapshot } from "./antigravity";
import { remaining, type Preferences, type Snapshot, type SourceId } from "./model";
import { creditPercent } from "./workbuddy";
import type { WorkbuddySnapshot } from "./workbuddyTypes";

export interface SourceReading {
  id: SourceId;
  short: "C" | "W" | "A";
  remaining: number;
}

/** Extract the tightest measured remaining percentage for each enabled source. */
export function collectSourceReadings(
  prefs: Preferences,
  codex: Snapshot | null,
  workbuddy: WorkbuddySnapshot | null,
  antigravity: AntigravitySnapshot | null,
): SourceReading[] {
  const items: SourceReading[] = [];
  if (prefs.codexEnabled && codex) {
    const vals = [300, 10080]
      .map((minutes) => remaining(codex.windows.find((w) => w.minutes === minutes)))
      .filter((v): v is number => v != null);
    if (vals.length > 0) {
      items.push({ id: "codex", short: "C", remaining: Math.min(...vals) });
    }
  }
  if (prefs.workbuddyEnabled && workbuddy) {
    const pct = creditPercent(workbuddy.remaining, workbuddy.total);
    if (pct != null) {
      items.push({ id: "workbuddy", short: "W", remaining: pct });
    }
  }
  if (prefs.antigravityEnabled && antigravity) {
    const quota = tightestQuota(miniGroups(antigravity.groups));
    if (quota != null) {
      items.push({ id: "antigravity", short: "A", remaining: quota.remaining });
    }
  }
  return items;
}

/** Build a compact macOS menu-bar title without inventing unavailable numbers. */
export function formatTrayTitle(
  prefs: Preferences,
  codex: Snapshot | null,
  workbuddy: WorkbuddySnapshot | null,
  antigravity: AntigravitySnapshot | null,
): string {
  if (prefs.trayTitleMode === "none" || !prefs.showTrayIcon) {
    return "";
  }
  const items = collectSourceReadings(prefs, codex, workbuddy, antigravity);
  if (items.length === 0) {
    return "";
  }
  if (prefs.trayTitleMode === "all") {
    return items
      .map((item) => {
        const pct = Math.round(item.remaining);
        return `${pct <= 10 ? "!" : ""}${item.short}${pct}%`;
      })
      .join(" ");
  }
  const tightest = items.reduce((min, cur) =>
    cur.remaining < min.remaining ? cur : min,
  );
  const pct = Math.round(tightest.remaining);
  return `${pct <= 10 ? "!" : ""}${tightest.short} ${pct}%`;
}
