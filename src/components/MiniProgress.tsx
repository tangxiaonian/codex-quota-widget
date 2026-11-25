/** A small remaining-quota meter shared by the mini overview and WorkBuddy's single-source view. */
export function MiniProgress({
  value,
  label,
  secondary = false,
}: {
  value: number | null;
  label: string;
  secondary?: boolean;
}) {
  const low = value != null && value <= 10;
  return (
    <span
      className={`mini-progress ${low ? "alert" : ""} ${secondary ? "secondary" : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value == null ? "额度未知" : `剩余 ${Math.round(value)}%`}
      title={`${label} · ${value == null ? "额度未知" : Math.round(value) + "%"}`}
    >
      {value != null && <span style={{ width: value + "%" }} />}
    </span>
  );
}
