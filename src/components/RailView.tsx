import {
  BarChart3,
  GripHorizontal,
  Maximize2,
  RefreshCw,
  Settings2,
} from "lucide-react";
import {
  compactGroup,
  primaryQuota,
  tightestQuota,
  visibleGroups,
  windowLabel,
} from "../antigravity";
import * as bridge from "../bridge";
import {
  duration,
  remaining,
  sourceOptions,
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

interface RailRingProps {
  id: SourceId;
  short: "C" | "W" | "A";
  name: string;
  pct: number | null;
  lowAlert: boolean;
  error: string | null;
  active: boolean;
  onHover: () => void;
  onClick: () => void;
}

/** Compact 40pt circular ring preferring 5-hour quota with centered typography and no native tooltip clutter. */
function RailRing({
  id,
  short,
  name,
  pct,
  lowAlert,
  error,
  active,
  onHover,
  onClick,
}: RailRingProps) {
  const radius = 16.5;
  const circumference = 2 * Math.PI * radius;
  const clamped = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const offset = circumference * (1 - clamped / 100);
  const tone =
    pct == null
      ? "unknown"
      : clamped <= 10 || lowAlert
        ? "critical"
        : clamped <= 30
          ? "warn"
          : "healthy";

  return (
    <button
      type="button"
      data-rail-source={id}
      className={`rail-ring ${tone} ${active ? "active" : ""}`}
      aria-label={`${name} ${pct == null ? "未读取" : `剩余 ${Math.round(clamped)}%`}`}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onClick}
    >
      <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
        <circle className="rail-track" cx="20" cy="20" r={radius} />
        {pct != null && (
          <circle
            className="rail-arc"
            cx="20"
            cy="20"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 20 20)"
          />
        )}
      </svg>
      <span className="rail-center">
        <strong className="rail-value">
          {pct == null ? "—" : Math.round(clamped)}
        </strong>
        <span className="rail-tag">{short}</span>
      </span>
      {error && <i className="rail-dot error" />}
      {lowAlert && <i className="rail-dot alert" />}
    </button>
  );
}

/** Hover detail card docked seamlessly beside the side rail rings. */
function RailHoverCard({
  source,
  preferences,
  codex,
  sources,
  todayUsage,
  todayBusy,
  now,
  etaMap,
  busy,
  onRefresh,
  onExpand,
  onOpenDashboard,
}: {
  source: SourceId;
  preferences: Preferences;
  codex: Snapshot | null;
  sources: SourceState;
  todayUsage: UsageReport | null;
  todayBusy: boolean;
  now: number;
  etaMap: Record<string, number | null>;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onExpand: (id: SourceId) => void;
  onOpenDashboard: (tab: "usage" | "settings") => void;
}) {
  const wb = sources.workbuddy;
  const ag = sources.antigravity;
  const agGroups = ag.snapshot?.groups ?? [];
  const todaySource =
    todayUsage?.bySource.find((item) => item.source === source) ?? null;
  const todayHit = todaySource
    ? cacheHitRate(todaySource.inputTokens, todaySource.cacheReadTokens)
    : null;
  const todayCost =
    todaySource && todaySource.estimatedUsd != null
      ? formatCost(
          todaySource.estimatedUsd,
          preferences.currency,
          preferences.usdToCny || 7.2,
        )
      : null;

  return (
    <section className="rail-popover" aria-label="额度详情">
      <div className="rail-popover-head">
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
          {codex?.availableCount != null && codex.availableCount > 0 && (
            <button
              type="button"
              className="rail-credit-link"
              onClick={() => onExpand("codex")}
            >
              可用重置卡 {codex.availableCount} 张 · 展开查看与使用
            </button>
          )}
          {sources.codexStatus && (
            <p className="rail-error">{sources.codexStatus}</p>
          )}
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
              {todayHit != null && <small>缓存 {Math.round(todayHit)}%</small>}
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
    </section>
  );
}

/** Freely draggable vertical side rail with near-edge snapping, sliver collapse, and inward hover popover. */
export function RailView({
  preferences,
  popoverSide,
  railOffsetY,
  codex,
  sources,
  todayUsage,
  todayBusy,
  now,
  etaMap,
  hovered,
  sliver,
  busy,
  reduceTransparency,
  onHover,
  onWake,
  onLeave,
  onDragStart,
  onRefresh,
  onExpand,
  onOpenDashboard,
}: {
  preferences: Preferences;
  popoverSide: RailEdge;
  railOffsetY: number;
  codex: Snapshot | null;
  sources: SourceState;
  todayUsage: UsageReport | null;
  todayBusy: boolean;
  now: number;
  etaMap: Record<string, number | null>;
  hovered: SourceId | null;
  sliver: boolean;
  busy: boolean;
  reduceTransparency: boolean;
  onHover: (id: SourceId) => void;
  onWake: () => void;
  onLeave: () => void;
  onDragStart: () => void;
  onRefresh: () => Promise<void>;
  onExpand: (id: SourceId) => void;
  onOpenDashboard: (tab: "usage" | "settings") => void;
}) {
  const enabled = sourceOptions.filter((s) => preferences[s.enabled]);

  /** Prefer 5-hour session remaining percentage on the rings; fall back when 5h is absent. */
  function getRingData(id: SourceId): { pct: number | null; low: boolean } {
    if (id === "codex") {
      const fiveH = remaining(codex?.windows.find((w) => w.minutes === 300));
      const weekly = remaining(codex?.windows.find((w) => w.minutes === 10080));
      const pct = fiveH ?? weekly;
      const low =
        (fiveH != null && fiveH <= 10) || (weekly != null && weekly <= 10);
      return { pct, low };
    }
    if (id === "workbuddy") {
      const pct = sources.workbuddy.snapshot
        ? creditPercent(
            sources.workbuddy.snapshot.remaining,
            sources.workbuddy.snapshot.total,
          )
        : null;
      return { pct, low: pct != null && pct <= 10 };
    }
    const groups = sources.antigravity.snapshot?.groups ?? [];
    const primary = primaryQuota(groups);
    const tightest = tightestQuota(visibleGroups(groups));
    return {
      pct: primary ? primary.remaining : null,
      low: tightest != null && tightest.remaining <= 10,
    };
  }

  function getError(id: SourceId): string | null {
    if (id === "codex") return sources.codexStatus;
    if (id === "workbuddy") return sources.workbuddy.error;
    return sources.antigravity.error;
  }

  const anyLow = enabled.some((s) => getRingData(s.id).low);

  if (sliver && !hovered) {
    return (
      <div
        className={`rail-sliver-shell edge-${preferences.railEdge}`}
        onMouseEnter={onWake}
        onClick={onWake}
        role="button"
        tabIndex={0}
        aria-label="展开额度圆环条"
      >
        <span className={`rail-sliver-bar ${anyLow ? "alert" : ""}`} />
      </div>
    );
  }

  const strip = (
    <aside
      className={`rail-strip ${reduceTransparency ? "opaque" : ""} ${anyLow ? "alert" : ""}`}
      style={
        railOffsetY > 0
          ? { marginTop: `${railOffsetY}px` }
          : undefined
      }
      aria-label="桌面额度圆环条"
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("button")) {
          onDragStart();
          bridge.drag();
        }
      }}
    >
      <div
        className="rail-drag-grip"
        title="拖动到桌面任意位置（靠近屏幕边缘自动吸附）"
        onMouseDown={() => {
          onDragStart();
          bridge.drag();
        }}
      >
        <GripHorizontal size={12} />
      </div>
      <div className="rail-rings">
        {enabled.map((source) => {
          const { pct, low } = getRingData(source.id);
          return (
            <RailRing
              key={source.id}
              id={source.id}
              short={
                source.id === "codex"
                  ? "C"
                  : source.id === "workbuddy"
                    ? "W"
                    : "A"
              }
              name={source.name}
              pct={pct}
              lowAlert={low}
              error={getError(source.id)}
              active={hovered === source.id}
              onHover={() => onHover(source.id)}
              onClick={() => onExpand(source.id)}
            />
          );
        })}
      </div>
      <button
        type="button"
        className="rail-action-btn"
        aria-label="打开统计与设置"
        title="Token 用量统计与设置"
        onClick={() => onOpenDashboard("usage")}
      >
        <BarChart3 size={13} />
      </button>
    </aside>
  );

  const popover = hovered ? (
    <RailHoverCard
      source={hovered}
      preferences={preferences}
      codex={codex}
      sources={sources}
      todayUsage={todayUsage}
      todayBusy={todayBusy}
      now={now}
      etaMap={etaMap}
      busy={busy}
      onRefresh={onRefresh}
      onExpand={onExpand}
      onOpenDashboard={onOpenDashboard}
    />
  ) : null;

  return (
    <main
      className={`rail-root side-${popoverSide} ${hovered ? "with-popover" : ""}`}
      onMouseLeave={onLeave}
    >
      {popoverSide === "left" ? (
        <>
          {popover}
          {strip}
        </>
      ) : (
        <>
          {strip}
          {popover}
        </>
      )}
    </main>
  );
}
