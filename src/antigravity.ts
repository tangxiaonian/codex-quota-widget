export interface AntigravityWindow {
  id: string;
  kind: string;
  name: string;
  remaining: number | null;
  resetsAt: number | null;
}
export interface AntigravityGroup {
  name: string;
  windows: AntigravityWindow[];
}
export type AntigravitySource = "languageServer" | "cli";
export interface AntigravitySnapshot {
  groups: AntigravityGroup[];
  fetchedAt: number;
  plan: string | null;
  source: AntigravitySource;
}

/** Keep unfamiliar quota windows named by the server. */
export function windowLabel(window: AntigravityWindow): string {
  if (window.kind === "weekly") {
    return "周";
  }
  if (window.kind === "session") {
    return "5 小时";
  }
  return window.name;
}

/** Hide Claude and GPT groups across all views so Antigravity focuses solely on Gemini quotas. */
export function visibleGroups(groups: AntigravityGroup[]): AntigravityGroup[] {
  return groups.filter((group) => !/\b(?:claude|gpt)\b/i.test(group.name));
}

/** Alias retained for callers expecting mini-layout filtering. */
export const miniGroups = visibleGroups;

/** Select the lowest measured quota among the given groups. */
export function tightestQuota(groups: AntigravityGroup[]) {
  let result: {
    group: string;
    window: AntigravityWindow;
    remaining: number;
  } | null = null;
  for (const group of groups) {
    for (const window of group.windows) {
      if (
        window.remaining != null &&
        (!result || window.remaining < result.remaining)
      ) {
        result = { group: group.name, window, remaining: window.remaining };
      }
    }
  }
  return result;
}

/** Prefer the 5-hour session window for the side rail; fall back to the tightest available window. */
export function primaryQuota(groups: AntigravityGroup[]) {
  const filtered = visibleGroups(groups);
  let session: {
    group: string;
    window: AntigravityWindow;
    remaining: number;
  } | null = null;
  for (const group of filtered) {
    for (const window of group.windows) {
      if (
        window.kind === "session" &&
        window.remaining != null &&
        (!session || window.remaining < session.remaining)
      ) {
        session = { group: group.name, window, remaining: window.remaining };
      }
    }
  }
  return session ?? tightestQuota(filtered);
}

/** Abbreviate the standard Gemini group and retain names for new groups. */
export function compactGroup(name: string): string {
  return name.replace(/^Gemini Models$/i, "Gemini");
}
