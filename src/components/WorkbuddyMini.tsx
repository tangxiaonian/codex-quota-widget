import { MiniProgress } from "./MiniProgress";
import { creditPercent, points } from "../workbuddy";
import type { WorkbuddySnapshot } from "../workbuddyTypes";
/** Keep the selected WorkBuddy balance readable in the fixed mini strip. */
export function WorkbuddyMini({
  snapshot,
}: {
  snapshot: WorkbuddySnapshot | null;
}) {
  const percent = snapshot
    ? creditPercent(snapshot.remaining, snapshot.total)
    : null;
  return (
    <div className="workbuddy-mini">
      <strong className={percent != null && percent <= 10 ? "low" : undefined}>
        {points(snapshot?.remaining)} <small>剩余积分</small>
      </strong>
      <span>
        {snapshot?.total != null
          ? `本周期总量 ${points(snapshot.total)}`
          : "积分总量未提供"}
      </span>
      <MiniProgress label="WorkBuddy 积分" value={percent} />
    </div>
  );
}
