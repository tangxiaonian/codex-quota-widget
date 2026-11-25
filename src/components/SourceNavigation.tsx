import {
  remaining,
  sourceOptions,
  type Preferences,
  type SourceId,
  type Snapshot,
} from "../model";
import { tightestQuota, type AntigravitySnapshot } from "../antigravity";
import { creditPercent } from "../workbuddy";
import type { WorkbuddySnapshot } from "../workbuddyTypes";
/** Switch details without changing the fixed native window or any account's identity. */
export function SourceNavigation({
  preferences,
  codex,
  workbuddy,
  codexError,
  workbuddyError,
  antigravity,
  antigravityError,
  onSelect,
}: {
  preferences: Preferences;
  codex: Snapshot | null;
  workbuddy: WorkbuddySnapshot | null;
  codexError: string | null;
  workbuddyError: string | null;
  antigravity: AntigravitySnapshot | null;
  antigravityError: string | null;
  onSelect: (id: SourceId) => void;
}) {
  const codexLow = codex?.windows.some((w) => {
    const n = remaining(w);
    return n != null && n <= 10;
  });
  const pct = workbuddy
    ? creditPercent(workbuddy.remaining, workbuddy.total)
    : null;
  const antigravityQuota = tightestQuota(antigravity?.groups ?? []);
  const errors = {
    codex: codexError,
    workbuddy: workbuddyError,
    antigravity: antigravityError,
  };
  const low = {
    codex: codexLow,
    workbuddy: pct != null && pct <= 10,
    antigravity: antigravityQuota != null && antigravityQuota.remaining <= 10,
  };
  return (
    <nav className="source-tabs" aria-label="额度来源">
      {sourceOptions
        .filter((source) => preferences[source.enabled])
        .map(({ id, name }) => (
          <button
            key={id}
            className={preferences.selectedSource === id ? "active" : ""}
            onClick={() => onSelect(id)}
          >
            {name}{" "}
            {errors[id] && (
              <span
                className="stale-dot"
                role="img"
                aria-label={`${name} 刷新失败`}
                title={errors[id] ?? undefined}
              />
            )}
            {low[id] && <span className="source-alert" aria-label="额度不足" />}
          </button>
        ))}
    </nav>
  );
}
