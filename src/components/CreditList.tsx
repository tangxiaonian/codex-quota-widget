import {
  canUse,
  duration,
  expiryDate,
  localizedTitle,
  sortedCredits,
  type Snapshot,
  type Credit,
  type Preferences,
} from "../model";
/** Render server card availability separately from quota refresh and window behavior. */
export function CreditList({
  snapshot,
  now,
  busy,
  fresh,
  preferences,
  lastUpdate,
  onChoose,
}: {
  snapshot: Snapshot | null;
  now: number;
  busy: boolean;
  fresh: boolean;
  preferences: Preferences;
  lastUpdate: string;
  onChoose: (credit: Credit) => void;
}) {
  const credits = sortedCredits(snapshot?.credits ?? []);
  const available = credits.filter((c) => canUse(c, now));
  const soonestId = available[0]?.id;
  return (
    <section className="credits-section">
      <div className="section-heading">
        <h1>我的重置卡</h1>
        <span className="badge">
          {snapshot?.availableCount == null
            ? "数量未提供"
            : `${snapshot.availableCount} 张可用`}
        </span>
      </div>
      {snapshot?.detailState === "unknown" && (
        <p className="empty-state">暂未提供卡片明细，刷新后再试。</p>
      )}
      {snapshot?.detailState === "partial" && (
        <p className="inline-hint">当前仅显示服务端返回的部分卡片。</p>
      )}
      {snapshot?.detailState === "empty" && (
        <p className="empty-state">暂时没有可用重置卡。</p>
      )}
      {!snapshot && <p className="empty-state">读取账号后查看可用重置卡。</p>}
      <div className="credit-list">
        {credits.map((credit, index) => {
          const usable = canUse(credit, now),
            urgent =
              usable &&
              credit.expiresAt != null &&
              credit.expiresAt - now < 43200;
          return (
            <article
              className={`credit ${credit.id === soonestId ? "soonest" : ""} ${urgent ? "urgent" : ""}`}
              key={credit.id}
            >
              <div className="credit-info">
                <div className="credit-heading">
                  <h2 title={localizedTitle(credit.title) ?? ""}>
                    {localizedTitle(credit.title) || `重置卡 ${index + 1}`}
                  </h2>
                  {available[0]?.id === credit.id &&
                    credit.expiresAt != null && (
                      <span className="expiry-badge">最近到期</span>
                    )}
                </div>
                <strong>
                  {usable
                    ? credit.expiresAt == null
                      ? "未提供到期时间"
                      : `剩余 ${duration(credit.expiresAt, now)}`
                    : credit.expiresAt != null && credit.expiresAt <= now
                      ? "已到期"
                      : credit.status === "redeeming"
                        ? "正在处理"
                        : "不可使用"}
                </strong>
                <small>
                  {credit.expiresAt != null
                    ? `${expiryDate(credit.expiresAt)} 到期`
                    : "到期信息以服务端为准"}
                </small>
              </div>
              <button
                className={
                  urgent ? "primary use-button" : "secondary-button use-button"
                }
                disabled={!usable || !fresh || busy}
                onClick={() => onChoose(credit)}
              >
                使用
              </button>
            </article>
          );
        })}
      </div>
      <footer>
        <span>
          <i className={fresh ? "status-dot" : "status-dot stale"} />
          {busy ? "更新中…" : `${fresh ? "更新于" : "缓存于"} ${lastUpdate}`}
        </span>
        <span>
          {preferences.autoRefresh
            ? `每 ${preferences.refreshMinutes} 分钟刷新`
            : "手动刷新"}
        </span>
      </footer>
    </section>
  );
}
