import { remaining, duration, type QuotaWindow } from "../model";
/**
 * One-line quota summary for the mini bar. Unknown data stays unknown:
 * the bar empties and the reading shows a dash instead of an invented value.
 */
export function MiniQuota({
  window,
  label,
  now,
  secondary = false,
}: {
  window?: QuotaWindow;
  label: string;
  now: number;
  secondary?: boolean;
}) {
  const value = remaining(window);
  const recovery =
    window?.resetsAt == null
      ? "恢复时间未提供"
      : window.resetsAt <= now
        ? "等待更新"
        : `${duration(window.resetsAt, now)}后恢复`;
  return (
    <div
      className={`mini-quota ${secondary ? "secondary" : ""} ${value != null && value <= 10 ? "alert" : ""}`}
      title={`${label}剩余 ${value == null ? "未提供" : `${Math.round(value)}%`}，${recovery}`}
    >
      <span className="mini-label">{label}</span>
      <span className="mini-track" aria-hidden="true">
        <span className="mini-fill" style={{ width: `${value ?? 0}%` }} />
      </span>
      <strong>{value == null ? "—" : `${Math.round(value)}%`}</strong>
      <small>{recovery}</small>
    </div>
  );
}
