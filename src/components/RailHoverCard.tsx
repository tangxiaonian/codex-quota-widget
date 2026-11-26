import { BarChart3, Maximize2, RefreshCw, Settings2 } from "lucide-react";
import { compactGroup, windowLabel } from "../antigravity";
import {
  duration,
  expiryDate,
  localizedTitle,
  remaining,
  soonestUsableCredit,
  type Preferences,
  type RailEdge,
  type Snapshot,
  type SourceId,
} from "../model";
import type { SourceState } from "../hooks/useSources";
import { creditPercent, points } from "../workbuddy";
import {
  cacheHitRate,
  formatCost,
  formatTokens,
  type UsageReport,
} from "../usageTypes";
import { MiniProgress } from "./MiniProgress";
import { SourceBadge } from "./SourceBadge";

export interface RailPopoverData {
  source: SourceId;
  popoverSide: RailEdge;
  closing: boolean;
  theme: Preferences["theme"];
  currency: Preferences["currency"];
  usdToCny: number;
  codex: Snapshot | null;
  codexStatus: string | null;
  workbuddy: Pick<SourceState["workbuddy"], "snapshot" | "error">;
  antigravity: Pick<SourceState["antigravity"], "snapshot" | "error">;
  todayUsage: UsageReport | null;
  todayBusy: boolean;
  now: number;
  etaMap: Record<string, number | null>;
  busy: boolean;
}

export type RailPopoverAction =
  | { type: "refresh" }
  | { type: "expand"; source: SourceId }
  | { type: "openDashboard"; tab: "usage" | "settings" }
  | { type: "close" };

export interface RailHoverCardProps extends RailPopoverData {
  onRefresh: () => void | Promise<void>;
  onExpand: (id: SourceId) => void;
  onOpenDashboard: (tab: "usage" | "settings") => void;
}

/** Hover detail card shared by the separate native popover window and browser demo preview. */
export function RailHoverCard({
  source,
  popoverSide,
  closing,
  currency,
  usdToCny,
  codex,
  codexStatus,
  workbuddy: wb,
  antigravity: ag,
  todayUsage,
  todayBusy,
  now,
  etaMap,
  busy,
  onRefresh,
  onExpand,
  onOpenDashboard,
}: RailHoverCardProps) {
  const agGroups = ag.snapshot?.groups ?? [];
  const nextCredit = codex ? soonestUsableCredit(codex.credits, now) : null;
  const nextCreditUrgent =
    nextCredit?.expiresAt != null && nextCredit.expiresAt - now < 43200;
  const hasCredits =
    (codex?.availableCount != null && codex.availableCount > 0) ||
    nextCredit != null;
  const todaySource =
    todayUsage?.bySource.find((item) => item.source === source) ?? null;
  const todayHit = todaySource
    ? cacheHitRate(todaySource.inputTokens, todaySource.cacheReadTokens)
    : null;
  const todayCost =
    todaySource && todaySource.estimatedUsd != null
      ? formatCost(todaySource.estimatedUsd, currency, usdToCny || 7.2)
      : null;

  return (
    <section
      className={`rail-popover from-${popoverSide} ${closing ? "closing" : ""}`}
      aria-label="额度详情"
    >
      <div className="rail-popover-inner" key={source}>
        <div className="rail-popover-head">
          <div className="rail-popover-ident">
            <SourceBadge source={source} className="rail-popover-icon" />
            <div className="rail-popover-title">
              <strong>
                {source === "codex"
                  ? "Codex"
                  : source === "workbuddy"
                    ? "WorkBuddy"
                    : "Antigravity"}
              </strong>
              <small>
                {source === "codex"
                  ? (codex?.account.email ?? "等待账号")
                  : source === "workbuddy"
                    ? (wb.snapshot?.plan ?? wb.snapshot?.name ?? "当前账号")
                    : ag.snapshot
                      ? `${ag.snapshot.plan ? `${ag.snapshot.plan} · ` : ""}${ag.snapshot.source === "cli" ? "agy CLI" : "桌面端"}`
                      : "未读取"}
              </small>
            </div>
          </div>
          <div className="rail-popover-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="刷新额度"
              title="刷新额度"
              disabled={busy}
              onClick={() => void onRefresh()}
            >
              <RefreshCw size={14} className={busy ? "loading" : ""} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="展开完整卡片"
              title="展开完整卡片"
              onClick={() => onExpand(source)}
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>

        {source === "codex" && (
          <div className="rail-popover-body">
            {[
              { minutes: 300, label: "5 小时额度", key: "codex:300" },
              { minutes: 10080, label: "周额度", key: "codex:10080" },
            ].map(({ minutes, label, key }) => {
              const win = codex?.windows.find((w) => w.minutes === minutes);
              const pct = remaining(win);
              const eta = etaMap[key];
              return (
                <div className="rail-row" key={minutes}>
                  <div className="rail-row-meta">
                    <span>{label}</span>
                    <strong className={pct != null && pct <= 10 ? "low" : ""}>
                      {pct == null ? "未提供" : `${Math.round(pct)}%`}
                    </strong>
                  </div>
                  <MiniProgress
                    value={pct}
                    label={label}
                    secondary={minutes === 10080}
                  />
                  <div className="rail-row-sub">
                    <span>
                      {win?.resetsAt != null
                        ? `${duration(win.resetsAt, now)}后恢复`
                        : "恢复时间未提供"}
                    </span>
                    {eta != null && (
                      <span className="burn-eta">
                        约 {duration(eta, now)}后见底
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {hasCredits && (
              <button
                type="button"
                className={`rail-credit-link ${nextCreditUrgent ? "urgent" : ""}`}
                onClick={() => onExpand("codex")}
                title={
                  nextCredit
                    ? `${localizedTitle(nextCredit.title) || "重置卡"} · ${
                        nextCredit.expiresAt != null
                          ? `${expiryDate(nextCredit.expiresAt)} 到期`
                          : "未提供到期时间"
                      }`
                    : "点击展开查看与使用重置卡"
                }
              >
                <span className="rail-credit-head">
                  <strong>可用重置卡 {codex?.availableCount ?? 1} 张</strong>
                  <small>展开使用 ›</small>
                </span>
                {nextCredit ? (
                  <span className="rail-credit-next">
                    <span className="rail-credit-name">
                      最近 · {localizedTitle(nextCredit.title) || "重置卡"}
                    </span>
                    <span
                      className={`rail-credit-expiry ${nextCreditUrgent ? "urgent" : ""}`}
                    >
                      {nextCredit.expiresAt != null
                        ? `${duration(nextCredit.expiresAt, now)}后过期`
                        : "到期时间未提供"}
                    </span>
                  </span>
                ) : (
                  codex?.detailState === "unknown" && (
                    <span className="rail-credit-next">
                      <span className="rail-credit-name">
                        卡片明细暂未提供，点击展开查看
                      </span>
                    </span>
                  )
                )}
              </button>
            )}
            {codexStatus && <p className="rail-error">{codexStatus}</p>}
          </div>
        )}

        {source === "workbuddy" && (
          <div className="rail-popover-body">
            {wb.snapshot ? (
              <div className="rail-row">
                <div className="rail-row-meta">
                  <span>剩余积分</span>
                  <strong>
                    {points(wb.snapshot.remaining)}
                    {wb.snapshot.total != null
                      ? ` / ${points(wb.snapshot.total)}`
                      : ""}
                  </strong>
                </div>
                <MiniProgress
                  value={creditPercent(wb.snapshot.remaining, wb.snapshot.total)}
                  label="WorkBuddy 积分"
                />
                <div className="rail-row-sub">
                  <span>有效积分包 {wb.snapshot.packages.length} 个</span>
                  <button
                    type="button"
                    className="rail-inline-btn"
                    onClick={() => onExpand("workbuddy")}
                  >
                    查看明细
                  </button>
                </div>
              </div>
            ) : (
              <p className="rail-empty">
                {wb.error ?? "等待读取 WorkBuddy 积分"}
              </p>
            )}
          </div>
        )}

        {source === "antigravity" && (
          <div className="rail-popover-body">
            {ag.snapshot && agGroups.length > 0 ? (
              agGroups.map((group) => (
                <div className="rail-ag-group" key={group.name}>
                  <h4>{compactGroup(group.name)}</h4>
                  {group.windows.map((win) => {
                    const eta = etaMap[`ag:${group.name}:${win.id}`];
                    return (
                      <div className="rail-row" key={win.id}>
                        <div className="rail-row-meta">
                          <span>{windowLabel(win)}额度</span>
                          <strong
                            className={
                              win.remaining != null && win.remaining <= 10
                                ? "low"
                                : ""
                            }
                          >
                            {win.remaining == null
                              ? "—"
                              : `${Math.round(win.remaining)}%`}
                          </strong>
                        </div>
                        <MiniProgress
                          value={win.remaining}
                          label={`${group.name} ${windowLabel(win)}`}
                          secondary={win.kind === "weekly"}
                        />
                        <div className="rail-row-sub">
                          <span>
                            {win.resetsAt != null
                              ? `${duration(win.resetsAt, now)}后恢复`
                              : "恢复时间未提供"}
                          </span>
                          {eta != null && (
                            <span className="burn-eta">
                              约 {duration(eta, now)}后见底
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            ) : (
              <p className="rail-empty">
                {ag.error ?? "等待读取 Gemini 额度"}
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          className="rail-today-usage"
          onClick={() => onOpenDashboard("usage")}
          title="点击打开完整 Token 用量统计"
        >
          <span className="rail-today-label">今日 Token</span>
          <span className="rail-today-val">
            {todaySource ? (
              <>
                <strong>{formatTokens(todaySource.totalTokens)}</strong>
                {todayHit != null && (
                  <small>缓存 {Math.round(todayHit)}%</small>
                )}
                {todayCost && <small>{todayCost}</small>}
              </>
            ) : todayBusy && !todayUsage ? (
              <small>扫描中…</small>
            ) : (
              <small>今日暂无记录</small>
            )}
          </span>
        </button>

        <div className="rail-popover-foot">
          <button
            type="button"
            className="rail-foot-btn"
            onClick={() => onOpenDashboard("usage")}
          >
            <BarChart3 size={12} /> Token 用量
          </button>
          <button
            type="button"
            className="rail-foot-btn"
            onClick={() => onOpenDashboard("settings")}
          >
            <Settings2 size={12} /> 偏好设置
          </button>
        </div>
      </div>
    </section>
  );
}
