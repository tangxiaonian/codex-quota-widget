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

const shortDateTime = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
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
  const seconds = until - now;
  if (seconds <= 0) {
    return {
      full: `上期有效至 ${fullDate.format(date)} · 新日期待同步`,
      compact: "订阅日期待同步",
    };
  }
  const withinDay = seconds < 86400;
  const remaining = withinDay
    ? remainingWithinDay(seconds)
    : `剩余 ${Math.ceil(seconds / 86400)} 天`;
  return {
    full: `订阅有效至 ${fullDate.format(date)} · ${remaining}`,
    compact: `有效至 ${(withinDay ? shortDateTime : shortDate).format(date)} · ${remaining}`,
  };
}

/** Show whole hours and minutes during the final day of the subscription. */
function remainingWithinDay(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (!minutes) return "剩余不足 1 分钟";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return (
    "剩余 " +
    [hours && `${hours} 小时`, rest && `${rest} 分`].filter(Boolean).join(" ")
  );
}
