import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, RefreshCw, X } from "lucide-react";
import * as bridge from "./bridge";
import { appendSample, estimateDepletion, type QuotaSample } from "./burnRate";
import { remaining, type RailEdge, type SourceId } from "./model";
import { useWidget } from "./useWidget";
import { useSources } from "./hooks/useSources";
import { useTheme } from "./hooks/useTheme";
import { useTodayUsage } from "./hooks/useTodayUsage";
import { useWindowBehavior } from "./hooks/useWindowBehavior";
import { useSubscription } from "./hooks/useSubscription";
import { useRedemption } from "./hooks/useRedemption";
import { CardHeader } from "./components/CardHeader";
import { SettingsView } from "./components/SettingsView";
import { CreditConfirmation } from "./components/CreditConfirmation";
import { ResizeEdges } from "./components/ResizeEdges";
import { SourceContent } from "./components/SourceContent";
import { RailView } from "./components/RailView";
import type { WindowMode } from "./window/geometry";

/** Compose floating views (side rail / mini bar / expanded card) and native window coordination. */
export default function App() {
  const w = useWidget();
  const { snapshot, preferences, now } = w;
  useTheme(preferences.theme);

  const sources = useSources(w);
  const {
    workbuddy: wb,
    antigravity,
    isAntigravity,
    isWorkbuddy,
    allSources,
    refreshAll,
    miniView,
  } = sources;

  const showingCodex = !isWorkbuddy && !isAntigravity;
  const activeSource = isAntigravity ? antigravity : isWorkbuddy ? wb : w;
  const subscription = useSubscription(
    preferences.codexEnabled && preferences.showSubscription,
    snapshot,
    now,
  );
  const redemption = useRedemption(w);
  const { selection, redeeming } = redemption;

  // Keep in-memory quota samples strictly for local burn-rate ETA projection.
  const samplesRef = useRef<Record<string, QuotaSample[]>>({});
  const etaMap = useMemo(() => {
    const next = { ...samplesRef.current };
    const result: Record<string, number | null> = {};
    if (snapshot) {
      for (const m of [300, 10080]) {
        const win = snapshot.windows.find((q) => q.minutes === m);
        const key = `codex:${m}`;
        next[key] = appendSample(next[key] ?? [], remaining(win), snapshot.fetchedAt);
        result[key] = estimateDepletion(next[key], win?.resetsAt, now);
      }
    }
    if (antigravity.snapshot) {
      for (const group of antigravity.snapshot.groups) {
        for (const win of group.windows) {
          const key = `ag:${group.name}:${win.id}`;
          next[key] = appendSample(
            next[key] ?? [],
            win.remaining,
            antigravity.snapshot.fetchedAt,
          );
          result[key] = estimateDepletion(next[key], win.resetsAt, now);
        }
      }
    }
    samplesRef.current = next;
    return result;
  }, [snapshot, antigravity.snapshot, now]);

  // Keep macOS menu bar icon-only without extra text clutter.
  useEffect(() => {
    if (!w.ready) return;
    void bridge.setTrayTitle("").catch(() => {});
  }, [w.ready]);

  // Rail hover, dynamic popover side & vertical offset compensation.
  const [hoveredRail, setHoveredRail] = useState<SourceId | null>(null);
  const [railLayout, setRailLayout] = useState<{
    popoverSide: RailEdge;
    railOffsetY: number;
  }>({ popoverSide: "left", railOffsetY: 0 });
  const [sliver, setSliver] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragCooldownTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draggingRef = useRef(false);

  const suppressHoverDuringDrag = () => {
    draggingRef.current = true;
    clearTimeout(hoverTimer.current);
    clearTimeout(leaveTimer.current);
    clearTimeout(dragCooldownTimer.current);
    dragCooldownTimer.current = setTimeout(() => {
      draggingRef.current = false;
    }, 360);
  };

  const compact = preferences.compact && !w.settings && !selection;
  const useRail = compact && preferences.desktopMode === "rail";
  const todayUsage = useTodayUsage(w.ready && useRail, w.lifecycle.sleeping);

  useEffect(() => {
    if (hoveredRail) {
      void todayUsage.refresh(false);
    }
  }, [hoveredRail, todayUsage.refresh]);

  useEffect(() => {
    setRailLayout((prev) => ({
      ...prev,
      popoverSide: preferences.railEdge === "left" ? "right" : "left",
    }));
  }, [preferences.railEdge]);

  // Unfocused hover support: native macOS pointer monitor hits rings even while another app holds focus.
  useEffect(() => {
    if (!useRail) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void bridge
      .onRailPointer(({ inside, x, y }) => {
        if (draggingRef.current) return;
        if (!inside) {
          clearTimeout(hoverTimer.current);
          clearTimeout(leaveTimer.current);
          leaveTimer.current = setTimeout(() => setHoveredRail(null), 260);
          return;
        }
        clearTimeout(leaveTimer.current);
        clearTimeout(collapseTimer.current);
        setSliver(false);
        const el = document.elementFromPoint(x, y);
        const ring = el?.closest<HTMLElement>("[data-rail-source]");
        const id = ring?.dataset.railSource as SourceId | undefined;
        if (id) {
          clearTimeout(hoverTimer.current);
          hoverTimer.current = setTimeout(() => setHoveredRail(id), 80);
        }
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, [useRail]);

  useEffect(() => {
    if (!useRail || !preferences.railAutoCollapse) {
      setSliver(false);
      clearTimeout(collapseTimer.current);
      return;
    }
    if (hoveredRail) {
      setSliver(false);
      clearTimeout(collapseTimer.current);
      return;
    }
    collapseTimer.current = setTimeout(() => setSliver(true), 3000);
    return () => clearTimeout(collapseTimer.current);
  }, [useRail, preferences.railAutoCollapse, hoveredRail]);

  useEffect(() => {
    if (!useRail) {
      setHoveredRail(null);
      setSliver(false);
    }
  }, [useRail]);

  // Size the hover popover tightly to content so bottom-area hovers avoid unnecessary upward shifts.
  const railHoverHeight = useMemo(() => {
    if (hoveredRail === "workbuddy") return 228;
    if (hoveredRail === "codex") {
      return snapshot?.availableCount && snapshot.availableCount > 0 ? 308 : 272;
    }
    if (hoveredRail === "antigravity") {
      const groups = antigravity.snapshot?.groups ?? [];
      if (groups.length === 0) return 228;
      const winCount = groups.reduce((sum, g) => sum + g.windows.length, 0);
      return Math.min(460, Math.max(276, 146 + groups.length * 24 + winCount * 47));
    }
    return 272;
  }, [hoveredRail, snapshot?.availableCount, antigravity.snapshot]);

  const mode: WindowMode = w.settings
    ? "settings"
    : selection
      ? "confirmation"
      : useRail
        ? hoveredRail
          ? "railHover"
          : sliver
            ? "railSliver"
            : "rail"
        : compact
          ? "compact"
          : "expanded";

  useWindowBehavior(
    w.ready,
    mode,
    preferences,
    w.update,
    w.setError,
    setRailLayout,
    railHoverHeight,
    () => {
      if (useRail && !hoveredRail) suppressHoverDuringDrag();
    },
  );

  /** Close auxiliary views without interrupting an explicit consumption request. */
  function back() {
    if (!redeeming) {
      redemption.cancel();
      w.setSettings(false);
    }
  }

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHoveredRail(null);
        back();
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [redeeming]);

  function openDashboardOrInline(tab: "usage" | "settings") {
    setHoveredRail(null);
    if (bridge.native && !w.demo) {
      void bridge.openDashboard(tab).catch((e) => w.setError(String(e)));
    } else {
      w.setSettings(true);
    }
  }

  const refreshVisible =
    useRail || (compact && allSources) ? refreshAll : activeSource.refresh;
  const visibleBusy =
    useRail || (compact && allSources)
      ? w.busy || wb.busy || antigravity.busy
      : activeSource.busy;

  if (useRail) {
    return (
      <RailView
        preferences={preferences}
        popoverSide={railLayout.popoverSide}
        railOffsetY={railLayout.railOffsetY}
        codex={snapshot}
        sources={sources}
        todayUsage={todayUsage.report}
        todayBusy={todayUsage.busy}
        now={now}
        etaMap={etaMap}
        hovered={hoveredRail}
        sliver={sliver}
        busy={visibleBusy}
        reduceTransparency={w.lifecycle.reduceTransparency}
        onHover={(id) => {
          if (draggingRef.current) return;
          clearTimeout(leaveTimer.current);
          clearTimeout(hoverTimer.current);
          setSliver(false);
          hoverTimer.current = setTimeout(() => setHoveredRail(id), 100);
        }}
        onWake={() => {
          clearTimeout(collapseTimer.current);
          setSliver(false);
        }}
        onLeave={() => {
          clearTimeout(hoverTimer.current);
          leaveTimer.current = setTimeout(() => setHoveredRail(null), 280);
        }}
        onDragStart={() => {
          suppressHoverDuringDrag();
          setHoveredRail(null);
        }}
        onRefresh={async () => {
          await Promise.all([refreshAll(), todayUsage.refresh(true)]);
        }}
        onExpand={(id) => {
          clearTimeout(hoverTimer.current);
          clearTimeout(leaveTimer.current);
          setHoveredRail(null);
          void w.update({ selectedSource: id, compact: false });
        }}
        onOpenDashboard={openDashboardOrInline}
      />
    );
  }

  const lowQuota =
    showingCodex &&
    [300, 10080].some((m) => {
      const value = remaining(snapshot?.windows.find((q) => q.minutes === m));
      return value != null && value <= 10;
    });
  const statusText = sources.status(compact);

  return (
    <main
      className={`card ${compact ? "compact" : "expanded"} ${w.lifecycle.reduceTransparency ? "opaque" : ""} ${lowQuota ? "quota-alert" : ""}`}
    >
      {!compact && <ResizeEdges onError={w.setError} />}
      <CardHeader
        identity={
          isAntigravity
            ? {
                name: "Antigravity",
                plan: antigravity.snapshot?.plan ?? null,
              }
            : isWorkbuddy
              ? {
                  name: wb.snapshot?.name ?? "WorkBuddy",
                  plan: wb.snapshot?.plan ?? null,
                }
              : undefined
        }
        onMiniView={miniView}
        subscription={!showingCodex || allSources ? null : subscription}
        compact={compact}
        snapshot={snapshot}
        preferences={preferences}
        busy={visibleBusy}
        settings={w.settings}
        selection={!!selection}
        redeeming={redeeming}
        onRefresh={refreshVisible}
        onSettings={() => openDashboardOrInline("settings")}
        onBack={back}
        onToggle={() => void w.update({ compact: !preferences.compact })}
      />
      {w.settings ? (
        <SettingsView
          preferences={preferences}
          demo={w.demo}
          update={w.update}
          onError={w.setError}
          onClose={back}
        />
      ) : selection ? (
        <CreditConfirmation
          selection={selection}
          now={now}
          demo={w.demo}
          busy={w.busy}
          fresh={w.fresh}
          redeeming={redeeming}
          accountKey={snapshot?.account.key}
          onCancel={redemption.cancel}
          onConfirm={redemption.confirm}
        />
      ) : (
        <SourceContent
          widget={w}
          sources={sources}
          compact={compact}
          subscription={subscription?.full ?? null}
          onChoose={redemption.choose}
        />
      )}
      {statusText && (
        <div className="status-banner" role="status">
          <Clock3 size={13} />
          <span title={statusText}>{statusText}</span>
          {!selection && !w.settings && (
            <button
              aria-label="重试刷新"
              onClick={() => void refreshVisible()}
              disabled={visibleBusy}
            >
              <RefreshCw size={13} />
            </button>
          )}
        </div>
      )}
      {w.notice &&
        preferences.codexEnabled &&
        (showingCodex || (compact && allSources)) &&
        (!compact || !statusText) && (
          <div className="notice" role="status">
            <span title={w.notice}>
              {compact && allSources ? "Codex · " : ""}
              {w.notice}
            </span>
            <button aria-label="关闭提示" onClick={() => w.setNotice(null)}>
              <X size={13} />
            </button>
          </div>
        )}
      {w.demo && !selection && (
        <div className="demo-label">演示模式 · 不连接真实账号</div>
      )}
    </main>
  );
}
