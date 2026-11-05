import { duration, remaining, type QuotaWindow } from "./model";
/** A fixed segmented arc expresses proportion; its endpoint glows without any running animation. */
export function Gauge({
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
  const value = remaining(window),
    fraction = (value ?? 0) / 100,
    radius = 66;
  const point = (angle: number, r: number) => ({
    x: 88 + Math.cos((angle * Math.PI) / 180) * r,
    y: 87 + Math.sin((angle * Math.PI) / 180) * r,
  });
  const dot = point(140 + 260 * fraction, radius);
  const recovery =
    window?.resetsAt == null
      ? "恢复时间未提供"
      : window.resetsAt <= now
        ? "等待额度更新"
        : `${duration(window.resetsAt, now)}后恢复`;
  return (
    <section
      className={`gauge ${secondary ? "secondary" : ""} ${value != null && value <= 10 ? "low" : ""}`}
      aria-label={`${label}，${value == null ? "未提供" : `剩余 ${Math.round(value)}%`}，${recovery}`}
    >
      <h2>{label}</h2>
      <div className="dial">
        <svg viewBox="0 0 176 158" aria-hidden="true">
          {Array.from({ length: 49 }, (_, i) => {
            const angle = 140 + (i * 260) / 48,
              a = point(angle, 63),
              b = point(angle, 70),
              active = Math.max(0, Math.min(1, fraction * 49 - i));
            return (
              <g key={i}>
                <line
                  className="tick-track"
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                />
                {active > 0 && value != null && (
                  <line
                    className="tick-active"
                    opacity={active}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                  />
                )}
              </g>
            );
          })}
          <path d="M 42 126 A 60 60 0 1 1 134 126" className="guide" />
          {value != null && value > 0 && (
            <>
              <circle className="endpoint-halo" cx={dot.x} cy={dot.y} r="6" />
              <circle className="endpoint" cx={dot.x} cy={dot.y} r="2.8" />
            </>
          )}
        </svg>
        <div className="reading">
          <strong>
            {value == null ? "—" : Math.round(value)}
            {value != null && <span>%</span>}
          </strong>
          <small>{value == null ? "未提供" : "剩余"}</small>
        </div>
      </div>
      <p>{recovery}</p>
    </section>
  );
}
