export interface Account {
  key: string;
  email: string | null;
  planType: string | null;
  workspaceName: string | null;
}
export interface QuotaWindow {
  minutes: number;
  usedPercent: number | null;
  resetsAt: number | null;
}
export interface Credit {
  id: string;
  status: string;
  title: string | null;
  description: string | null;
  resetType: string | null;
  expiresAt: number | null;
  grantedAt: number | null;
}
export interface Snapshot {
  account: Account;
  windows: QuotaWindow[];
  availableCount: number | null;
  detailState: "unknown" | "empty" | "partial" | "present";
  credits: Credit[];
  fetchedAt: number;
}
export interface WindowSize {
  width: number;
  height: number;
}
export interface Preferences {
  showSubscription: boolean;
  expandedSize: WindowSize | null;
  compact: boolean;
  autoRefresh: boolean;
  refreshMinutes: number;
  alwaysOnTop: boolean;
  followCodex: boolean;
  showTrayIcon: boolean;
  x: number | null;
  y: number | null;
}
export interface Lifecycle {
  running: boolean;
  sleeping: boolean;
  reduceTransparency: boolean;
}
export interface Bootstrap {
  preferences: Preferences;
  cached: Snapshot | null;
  lifecycle: Lifecycle;
  demo?: boolean;
}
export const defaults: Preferences = {
  showSubscription: false,
  expandedSize: null,
  compact: true,
  autoRefresh: true,
  refreshMinutes: 5,
  alwaysOnTop: false,
  followCodex: true,
  showTrayIcon: true,
  x: null,
  y: null,
};
/** Preserve unknown as unknown; progress must never fabricate an empty or full quota. */
export function remaining(window?: QuotaWindow): number | null {
  const used = window?.usedPercent;
  return typeof used === "number" &&
    Number.isFinite(used) &&
    used >= 0 &&
    used <= 100
    ? 100 - used
    : null;
}
/** Minute-resolution labels share one clock across both quotas and all credits. */
export function duration(
  until: number | null | undefined,
  now: number,
): string {
  if (until == null) return "时间未提供";
  const minutes = Math.ceil((until - now) / 60);
  if (minutes <= 0) return "已到时间";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
  return `${hours} 小时 ${minutes % 60} 分`;
}
/** Unknown status and expired cards remain visible but cannot be redeemed. */
export function canUse(credit: Credit, now: number): boolean {
  return (
    credit.status === "available" &&
    (credit.expiresAt == null || credit.expiresAt > now)
  );
}
/** Sort by nearest expiry, leaving undated cards at the end. */
export function sortedCredits(credits: Credit[]): Credit[] {
  return [...credits].sort(
    (a, b) =>
      (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) ||
      a.id.localeCompare(b.id),
  );
}
/** Render the complete date in the user's system timezone. */
export function expiryDate(time: number | null): string {
  return time == null
    ? "未提供到期时间"
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(time * 1000));
}
/** Only known outcomes may produce a success message. */
export function outcomeMessage(outcome: string): string {
  switch (outcome) {
    case "reset":
      return "重置卡已使用，正在更新额度";
    case "alreadyRedeemed":
      return "这次操作此前已完成，正在更新额度";
    case "nothingToReset":
      return "当前没有可重置的额度窗口";
    case "noCredit":
      return "当前没有可用重置卡，请查看最新状态";
    default:
      return "结果待确认，请刷新卡片状态";
  }
}
/**
 * Translate known English credit titles from the server for display.
 * Unknown titles pass through unchanged so we never invent card semantics.
 */
export function localizedTitle(title: string | null): string | null {
  if (title == null) return null;
  let out = title
    .replace(/full reset/gi, "完整重置")
    .replace(/partial reset/gi, "部分重置")
    .replace(/rate limit reset/gi, "额度重置")
    .replace(/weekly/gi, "周额度")
    .replace(/5\s*hours?|5\s*hr\b/gi, "5 小时");
  if (out !== title) {
    // Only when a keyword matched do we also normalize ASCII parens and spacing.
    out = out
      .replace(/\s*\(\s*/g, "（")
      .replace(/\s*\)\s*/g, "）")
      .replace(/\s+/g, " ")
      .trim();
  }
  return out;
}
/** Explicit demo data is isolated from all production commands and account storage. */
export function demoSnapshot(): Snapshot {
  const now = Math.floor(Date.now() / 1000);
  return {
    account: {
      key: "demo-only",
      email: "alex@example.com",
      planType: "Plus",
      workspaceName: null,
    },
    windows: [
      { minutes: 300, usedPercent: 28, resetsAt: now + 8280 },
      { minutes: 10080, usedPercent: 62, resetsAt: now + 280800 },
    ],
    availableCount: 2,
    detailState: "present",
    fetchedAt: now,
    credits: [
      {
        id: "demo-A",
        status: "available",
        title: "Full reset (Weekly + 5 hr)",
        description: "重置符合条件的 Codex 额度窗口",
        resetType: "codexRateLimits",
        expiresAt: now + 23040,
        grantedAt: now - 86400,
      },
      {
        id: "demo-B",
        status: "available",
        title: "Partial reset (5 hr)",
        description: null,
        resetType: "codexRateLimits",
        expiresAt: now + 288000,
        grantedAt: now - 86400,
      },
    ],
  };
}
