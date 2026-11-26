import { BarChart3, GripHorizontal } from "lucide-react";
import { primaryQuota, tightestQuota, visibleGroups } from "../antigravity";
import * as bridge from "../bridge";
import {
  remaining,
  sourceOptions,
  type Preferences,
  type RailEdge,
  type Snapshot,
  type SourceId,
} from "../model";
import type { SourceState } from "../hooks/useSources";
import { creditPercent } from "../workbuddy";
import type { UsageReport } from "../usageTypes";
import { RailHoverCard } from "./RailHoverCard";
import { SourceBadge } from "./SourceBadge";

interface RailRingProps {
  id: SourceId;
  name: string;
  pct: number | null;
  lowAlert: boolean;
  error: string | null;
  active: boolean;
  onHover: () => void;
  onClick: () => void;
}

/** Compact 44pt Apple Watch style horseshoe gauge with an unobstructed emblem and bottom readout. */
function RailRing({
  id,
  name,
  pct,
  lowAlert,
  error,
  active,
  onHover,
  onClick,
}: RailRingProps) {
  const radius = 18.8;
  const circumference = 2 * Math.PI * radius;
  const spanDeg = 280;
  // Center the 80° bottom gap around 6 o'clock (90° in SVG coordinates) so the readout sits cleanly in the opening.
  const startDeg = 90 + (360 - spanDeg) / 2;
  const trackLength = (circumference * spanDeg) / 360;
  const clamped = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const arcLength = trackLength * (clamped / 100);
  const rounded = pct == null ? null : Math.round(clamped);
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
      aria-label={`${name} ${rounded == null ? "未读取" : `剩余 ${rounded}%`}`}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onClick}
    >
      <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
        <circle
          className="rail-track"
          cx="22"
          cy="22"
          r={radius}
          strokeDasharray={`${trackLength} ${circumference}`}
          transform={`rotate(${startDeg} 22 22)`}
        />
        {pct != null && clamped > 0 && (
          <circle
            className="rail-arc"
            cx="22"
            cy="22"
            r={radius}
            strokeDasharray={`${arcLength} ${circumference}`}
            transform={`rotate(${startDeg} 22 22)`}
          />
        )}
      </svg>
      <span className="rail-artwork" aria-hidden="true">
        <SourceBadge source={id} className="rail-artwork-img" />
      </span>
      <strong className={`rail-value ${rounded === 100 ? "full" : ""}`}>
        {rounded == null ? "—" : rounded}
      </strong>
      {error && <i className="rail-dot error" />}
      {lowAlert && <i className="rail-dot alert" />}
    </button>
  );
}

/** Freely draggable vertical side rail with near-edge snapping, sliver collapse, and hover popover. */
export function RailView({
  preferences,
  popoverSide,
  railOffsetY,
  closing,
  inlinePopover = true,
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
  closing: boolean;
  inlinePopover?: boolean;
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
        inlinePopover && railOffsetY > 0
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

  const popover =
    inlinePopover && hovered ? (
      <RailHoverCard
        source={hovered}
        popoverSide={popoverSide}
        closing={closing}
        theme={preferences.theme}
        currency={preferences.currency}
        usdToCny={preferences.usdToCny}
        codex={codex}
        codexStatus={sources.codexStatus}
        workbuddy={{
          snapshot: sources.workbuddy.snapshot,
          error: sources.workbuddy.error,
        }}
        antigravity={{
          snapshot: sources.antigravity.snapshot,
          error: sources.antigravity.error,
        }}
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
      className={`rail-root side-${popoverSide} ${popover ? "with-popover" : ""}`}
      onMouseLeave={inlinePopover ? onLeave : undefined}
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
