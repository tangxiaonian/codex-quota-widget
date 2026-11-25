import {
  compactGroup,
  miniGroups,
  tightestQuota,
  windowLabel,
} from "../antigravity";
import type { AntigravityState } from "../hooks/useAntigravity";
import { MiniProgress } from "./MiniProgress";

/** Summarize the most constrained Antigravity window in one overview row. */
export function AntigravityMiniRow({
  state,
  onSelect,
}: {
  state: AntigravityState;
  onSelect: () => void;
}) {
  const groups = miniGroups(state.snapshot?.groups ?? []);
  const quota = tightestQuota(groups);
  const reading = quota
    ? `${compactGroup(quota.group)} · ${windowLabel(quota.window)} ${Math.round(quota.remaining)}%`
    : state.busy
      ? "读取中…"
      : state.snapshot
        ? "暂无可显示额度"
        : "额度未读取";
  return (
    <button
      className="source-mini-row antigravity-overview"
      onClick={onSelect}
      title={state.error ?? `Antigravity · ${reading}`}
    >
      <span className="mini-source-mark">A</span>
      <strong>Antigravity</strong>
      <span
        className={`source-mini-reading ${quota && quota.remaining <= 10 ? "low" : ""}`}
      >
        {reading}
      </span>
      <span className="source-mini-meters">
        <MiniProgress
          label={
            quota
              ? `Antigravity ${quota.group} ${windowLabel(quota.window)}`
              : "Antigravity 额度"
          }
          value={quota?.remaining ?? null}
        />
      </span>
      {state.error && <i className="stale-dot" />}
    </button>
  );
}
