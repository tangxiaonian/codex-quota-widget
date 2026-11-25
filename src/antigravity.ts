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

/** Select a known measured quota, keeping its group and window together. */
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

/** Keep Claude and GPT groups out of both mini layouts without changing the snapshot. */
export function miniGroups(groups: AntigravityGroup[]): AntigravityGroup[] {
  return groups.filter((group) => !/\b(?:claude|gpt)\b/i.test(group.name));
}

/** Abbreviate the standard Gemini group and retain names for new groups. */
export function compactGroup(name: string): string {
  return name.replace(/^Gemini Models$/i, "Gemini");
}
