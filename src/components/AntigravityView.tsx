import {
  compactGroup,
  visibleGroups,
  windowLabel,
  type AntigravityWindow,
} from "../antigravity";
import type { AntigravityState } from "../hooks/useAntigravity";
import { duration } from "../model";
import { MiniProgress } from "./MiniProgress";

/** Show one window's measured remaining quota and reset time. */
function QuotaReading({
  group,
  window,
  now,
}: {
  group: string;
  window: AntigravityWindow;
  now: number;
}) {
  const label = windowLabel(window);
  const { resetsAt } = window;
  const resetTime = resetsAt == null ? null : new Date(resetsAt * 1000);
  return (
    <div className="antigravity-reading">
      <span>
        {label}
        {resetTime && resetsAt != null && (
          <small title={resetTime.toLocaleString("zh-CN", { hour12: false })}>
            {resetsAt <= now
              ? "已到恢复时间"
              : `${duration(resetsAt, now)}后恢复`}
          </small>
        )}
      </span>
      <strong
        className={
          window.remaining != null && window.remaining <= 10 ? "low" : undefined
        }
      >
        {window.remaining == null ? "—" : `${Math.round(window.remaining)}%`}
      </strong>
      <MiniProgress
        value={window.remaining}
        label={`${group} ${label}`}
        secondary={window.kind === "weekly"}
      />
    </div>
  );
}

/** Show all reported groups in detail, with a filtered list in the mini card. */
export function AntigravityView({
  state,
  compact,
  now,
}: {
  state: AntigravityState;
  compact: boolean;
  now: number;
}) {
  if (!state.snapshot) {
    return state.error ? null : (
      <p className="setting-help">
        {state.busy
          ? "正在读取 Antigravity 额度…"
          : "等待读取 Antigravity 额度"}
      </p>
    );
  }
  const groups = compact
    ? visibleGroups(state.snapshot.groups)
    : state.snapshot.groups;
  if (groups.length === 0) {
    return <p className="setting-help">暂无可显示额度</p>;
  }
  const sourceLabel =
    state.snapshot.source === "cli" ? "agy CLI" : "桌面端";
  return (
    <section
      className={compact ? "antigravity-mini" : "antigravity-view"}
      aria-label="Antigravity 额度"
    >
      {!compact && (
        <h1>
          Antigravity{" "}
          <small>
            {state.snapshot.plan
              ? `${state.snapshot.plan} · ${sourceLabel}`
              : sourceLabel}
          </small>
        </h1>
      )}
      {groups.map((group) => (
        <div key={group.name} className="antigravity-group">
          <h2 title={group.name}>
            {compact ? compactGroup(group.name) : group.name}
          </h2>
          <div className="antigravity-windows">
            {group.windows.map((window) => (
              <QuotaReading
                key={window.id}
                group={group.name}
                window={window}
                now={now}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
