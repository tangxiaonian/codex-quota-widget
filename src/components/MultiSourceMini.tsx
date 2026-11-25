import { AntigravityMiniRow } from "./AntigravityMiniRow";
import type { AntigravityState } from "../hooks/useAntigravity";
import { MiniProgress } from "./MiniProgress";
import type { Preferences, Snapshot, SourceId } from "../model";
import { remaining } from "../model";
import { creditPercent, points } from "../workbuddy";
import type { WorkbuddyState } from "../workbuddyTypes";
/** Show one row per enabled provider while keeping the status line separate. */
export function MultiSourceMini({
  preferences,
  codex,
  codexError,
  workbuddy,
  antigravity,
  onSelect,
}: {
  preferences: Preferences;
  codex: Snapshot | null;
  codexError: string | null;
  workbuddy: WorkbuddyState;
  antigravity: AntigravityState;
  onSelect: (id: SourceId) => void;
}) {
  const fiveHour = remaining(codex?.windows.find((w) => w.minutes === 300));
  const weekly = remaining(codex?.windows.find((w) => w.minutes === 10080));
  const formatPercent = (value: number | null) =>
    value == null ? "—" : Math.round(value) + "%";
  const workbuddyPercent = workbuddy.snapshot
    ? creditPercent(workbuddy.snapshot.remaining, workbuddy.snapshot.total)
    : null;
  return (
    <div className="source-mini-rows">
      {preferences.codexEnabled && (
        <button
          className="source-mini-row"
          onClick={() => onSelect("codex")}
          title={codexError ?? codex?.account.email ?? "Codex"}
        >
          <span className="mini-source-mark">C</span>
          <strong>Codex</strong>
          <span className="source-mini-windows">
            <span className="source-mini-window">
              <span
                className={
                  fiveHour != null && fiveHour <= 10 ? "low" : undefined
                }
              >
                {codexError && codex ? "上次 " : ""}5h {formatPercent(fiveHour)}
              </span>
              <MiniProgress label="Codex 5 小时额度" value={fiveHour} />
            </span>
            <span className="source-mini-window">
              <span
                className={weekly != null && weekly <= 10 ? "low" : undefined}
              >
                周 {formatPercent(weekly)}
              </span>
              <MiniProgress label="Codex 周额度" value={weekly} secondary />
            </span>
          </span>
          {codexError && <i className="stale-dot" />}
        </button>
      )}
      {preferences.workbuddyEnabled && (
        <button
          className="source-mini-row"
          onClick={() => onSelect("workbuddy")}
          title={workbuddy.error ?? workbuddy.snapshot?.name ?? "WorkBuddy"}
        >
          <span className="mini-source-mark">W</span>
          <strong>WorkBuddy</strong>
          <span
            className={
              "source-mini-reading " +
              (workbuddyPercent != null && workbuddyPercent <= 10 ? "low" : "")
            }
          >
            {workbuddy.snapshot
              ? (workbuddy.error ? "上次 " : "") +
                points(workbuddy.snapshot.remaining) +
                " 积分"
              : workbuddy.busy
                ? "读取中…"
                : "需登录"}
          </span>
          <span className="source-mini-meters">
            <MiniProgress label="WorkBuddy 积分" value={workbuddyPercent} />
          </span>
          {workbuddy.error && <i className="stale-dot" />}
        </button>
      )}
      {preferences.antigravityEnabled && (
        <AntigravityMiniRow
          state={antigravity}
          onSelect={() => onSelect("antigravity")}
        />
      )}
    </div>
  );
}
