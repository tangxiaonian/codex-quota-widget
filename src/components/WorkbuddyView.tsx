import { RefreshCw } from "lucide-react";
import {
  creditPercent,
  packageTime,
  points,
  sortedPackages,
} from "../workbuddy";
import type { WorkbuddyState } from "../workbuddyTypes";
/** Present confirmed WorkBuddy billing fields; optional statistics stay absent. */
export function WorkbuddyView({
  state,
  now,
}: {
  state: WorkbuddyState;
  now: number;
}) {
  const s = state.snapshot;
  if (!s)
    return (
      <section className="source-empty">
        <span className="brand-mark">W</span>
        <h2>WorkBuddy</h2>
        <p>
          {state.busy
            ? "正在读取当前账号…"
            : (state.error ?? "打开 WorkBuddy 并登录后刷新")}
        </p>
        <button
          className="primary"
          disabled={state.busy}
          onClick={() => void state.refresh()}
        >
          <RefreshCw size={14} />
          重新读取
        </button>
      </section>
    );
  const pct = creditPercent(s.remaining, s.total);
  return (
    <section className="workbuddy-view">
      <div className="account-row">
        <div>
          <span className="email" title={s.name}>
            {s.name}
          </span>
        </div>
        {s.plan && <span className="badge">{s.plan}</span>}
      </div>
      <div
        className={"points-reading " + (pct != null && pct <= 10 ? "low" : "")}
      >
        <strong>{points(s.remaining)}</strong>
        <span>剩余积分</span>
      </div>
      {pct != null && (
        <div className="points-track">
          <div style={{ width: pct + "%" }} />
        </div>
      )}
      {s.used != null && (
        <p className="points-caption">
          已用 {points(s.used)}
          {s.total != null && <> / {points(s.total)}</>} 积分
        </p>
      )}
      <div className="points-details">
        <div className="section-heading">
          <h2>积分明细</h2>
          {pct != null && (
            <span className="muted">剩余 {Math.round(pct)}%</span>
          )}
        </div>
        {s.packageError && (
          <p className="package-error" role="status">
            {s.packageError}
          </p>
        )}
        {s.packages.length ? (
          sortedPackages(s.packages).map((item) => (
            <div className="points-package" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <small>{packageTime(item, now) ?? "到期时间未提供"}</small>
              </div>
              <span>
                {points(item.remaining)}
                <small>
                  {item.total != null ? "/ " + points(item.total) : "积分"}
                </small>
              </span>
            </div>
          ))
        ) : (
          <p className="muted">未提供积分明细</p>
        )}
      </div>
      <footer>
        <span className="fresh-dot" />{" "}
        {state.error ? "上次成功更新 " : "更新于 "}
        {new Date(s.fetchedAt * 1000).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </footer>
    </section>
  );
}
