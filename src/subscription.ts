const fullDate = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const shortDate = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface SubscriptionText {
  full: string;
  compact: string;
}

/** Format the end of the current entitlement period; it carries no cancellation or renewal status. */
export function subscriptionText(
  until: number | null,
  now: number,
): SubscriptionText | null {
  if (!until || !Number.isFinite(until)) return null;
  const date = new Date(until * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.ceil((until - now) / 86400);
  const remaining =
    until <= now
      ? "该日期已过"
      : until - now < 86400
        ? "剩余不足 1 天"
        : `剩余 ${days} 天`;
  return {
    full: `订阅有效至 ${fullDate.format(date)} · ${remaining}`,
    compact: `有效至 ${shortDate.format(date)} · ${remaining}`,
  };
}
