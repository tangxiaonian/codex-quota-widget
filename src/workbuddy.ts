import type { Package } from "./workbuddyTypes";
/** Render billing precision consistently without hiding fractional credits. */
export function points(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
/** Only a known, positive denominator can produce a remaining percentage. */
export function creditPercent(
  remaining: number | null,
  total: number | null,
): number | null {
  return remaining != null &&
    total != null &&
    total > 0 &&
    remaining >= 0 &&
    remaining <= total
    ? (remaining / total) * 100
    : null;
}
/** Keep the resource's own expiry distinct from the plan's subscription term. */
export function packageTime(item: Package, now: number): string | null {
  if (item.expiresAt == null) return null;
  return item.expiresAt <= now
    ? "已到期"
    : new Date(item.expiresAt * 1000).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }) + " 到期";
}

/** Put the nearest expiry first without mutating the received snapshot; undated packages follow. */
export function sortedPackages(packages: Package[]): Package[] {
  return [...packages].sort(
    (a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity),
  );
}
