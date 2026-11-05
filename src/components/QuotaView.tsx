import { Gauge } from "../Gauge";
import { MiniQuota } from "./MiniQuota";
import type { Snapshot } from "../model";
/** Share account and quota data between the compact bars and expanded gauges. */
export function QuotaView({
  compact,
  snapshot,
  busy,
  now,
}: {
  compact: boolean;
  snapshot: Snapshot | null;
  busy: boolean;
  now: number;
}) {
  return (
    <>
      {/* Expanded view carries the full account row; mini bar shows it in the header. */}
      {!compact && (
        <div className="account-row">
          <div>
            <span className="email" title={snapshot?.account.email ?? ""}>
              {snapshot?.account.email ??
                (busy ? "正在读取账号…" : "等待账号信息")}
            </span>
            {snapshot?.account.workspaceName && (
              <small>{snapshot.account.workspaceName}</small>
            )}
          </div>
          <span className="badge">{snapshot?.account.planType ?? "Codex"}</span>
        </div>
      )}
      {compact ? (
        /* Mini bar: two thin quota lines replace the large gauges. */
        <div className="mini-quotas">
          <MiniQuota
            window={snapshot?.windows.find((q) => q.minutes === 300)}
            label="5 小时"
            now={now}
          />
          <MiniQuota
            window={snapshot?.windows.find((q) => q.minutes === 10080)}
            label="周"
            secondary
            now={now}
          />
        </div>
      ) : (
        <div className="gauges">
          <Gauge
            window={snapshot?.windows.find((q) => q.minutes === 300)}
            label="5 小时额度"
            now={now}
          />
          <Gauge
            window={snapshot?.windows.find((q) => q.minutes === 10080)}
            label="周额度"
            now={now}
            secondary
          />
        </div>
      )}
    </>
  );
}
