import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, RefreshCw, X } from "lucide-react";
import * as bridge from "./bridge";
import { appendSample, estimateDepletion, type QuotaSample } from "./burnRate";
import {
  remaining,
  soonestUsableCredit,
  sourceOptions,
  type RailEdge,
  type SourceId,
} from "./model";
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
import type { RailPopoverData } from "./components/RailHoverCard";
import { railHeight, type WindowMode } from "./window/geometry";

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

  // Rail hover, dynamic popover side, close transition & separate native popover coordination.
  const [hoveredRail, setHoveredRail] = useState<SourceId | null>(null);
  const [closingRail, setClosingRail] = useState(false);
  const [railLayout, setRailLayout] = useState<{
    popoverSide: RailEdge;
    railOffsetY: number;
  }>({ popoverSide: "left", railOffsetY: 0 });
  const [sliver, setSliver] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeAnimTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragCooldownTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draggingRef = useRef(false);
  const hoveredRailRef = useRef<SourceId | null>(null);
  const closingRailRef = useRef(false);
  const pendingHoverRef = useRef<SourceId | null>(null);
  const popoverSeqRef = useRef(0);
  const popoverShownKeyRef = useRef<string | null>(null);
  const popoverSideRef = useRef<RailEdge>("left");
  const popoverOpeningRef = useRef(false);
  const pendingPopoverSyncRef = useRef<RailPopoverData | null>(null);
  hoveredRailRef.current = hoveredRail;
  closingRailRef.current = closingRail;

  const openRailSource = (id: SourceId, delayMs: number) => {
    clearTimeout(leaveTimer.current);
    clearTimeout(closeAnimTimer.current);
    clearTimeout(collapseTimer.current);
    if (closingRailRef.current) {
      setClosingRail(false);
    }
    setSliver(false);
    // Avoid restarting the hover timer on every 1px mousemove while already open or queued for the same source.
    if (hoveredRailRef.current === id || pendingHoverRef.current === id) {
      return;
    }
    clearTimeout(hoverTimer.current);
    pendingHoverRef.current = id;
    hoverTimer.current = setTimeout(() => {
      pendingHoverRef.current = null;
      setClosingRail(false);
      setHoveredRail(id);
    }, delayMs);
  };

  const scheduleRailClose = (delayMs: number) => {
    clearTimeout(hoverTimer.current);
    pendingHoverRef.current = null;
    if (!hoveredRailRef.current) return;
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      setClosingRail(true);
      clearTimeout(closeAnimTimer.current);
      closeAnimTimer.current = setTimeout(() => {
        setHoveredRail(null);
        setClosingRail(false);
      }, 145);
    }, delayMs);
  };

  const closeRailImmediately = () => {
    clearTimeout(hoverTimer.current);
    clearTimeout(leaveTimer.current);
    clearTimeout(closeAnimTimer.current);
    pendingHoverRef.current = null;
    popoverShownKeyRef.current = null;
    popoverOpeningRef.current = false;
    pendingPopoverSyncRef.current = null;
    popoverSeqRef.current += 1;
    setClosingRail(false);
    setHoveredRail(null);
    if (bridge.native) {
      void bridge.hideRailPopover().catch(() => {});
    }
  };

  const suppressHoverDuringDrag = () => {
    draggingRef.current = true;
    clearTimeout(hoverTimer.current);
    clearTimeout(leaveTimer.current);
    clearTimeout(closeAnimTimer.current);
    clearTimeout(dragCooldownTimer.current);
    pendingHoverRef.current = null;
    dragCooldownTimer.current = setTimeout(() => {
      draggingRef.current = false;
    }, 360);
  };

  const compact = preferences.compact && !w.settings && !selection;
  const useRail = compact && preferences.desktopMode === "rail";
  const todayUsage = useTodayUsage(w.ready && useRail, w.lifecycle.sleeping);
  const enabledRailCount = sourceOptions.filter((s) => preferences[s.enabled]).length;
  const railBaseHeight = railHeight(enabledRailCount);

  useEffect(() => {
    if (hoveredRail) {
      void todayUsage.refresh(false);
    }
  }, [hoveredRail, todayUsage.refresh]);

  useEffect(() => {
    const side: RailEdge = preferences.railEdge === "left" ? "right" : "left";
    popoverSideRef.current = side;
    setRailLayout((prev) => ({
      ...prev,
      popoverSide: side,
    }));
  }, [preferences.railEdge]);

  // Pre-create the hidden native popover window when entering rail mode, and hide it on exit.
  useEffect(() => {
    if (!bridge.native || !w.ready) return;
    if (useRail) {
      void bridge.prewarmRailPopover().catch(() => {});
      return;
    }
    popoverShownKeyRef.current = null;
    popoverSeqRef.current += 1;
    void bridge.hideRailPopover().catch(() => {});
  }, [w.ready, useRail]);

  // Unfocused hover support: native macOS pointer monitor tracks both the stationary rail and separate popover window.
  useEffect(() => {
    if (!useRail) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void bridge
      .onRailPointer(({ inside, target, x, y }) => {
        if (draggingRef.current) return;
        if (!inside || target === "none") {
          scheduleRailClose(220);
          return;
        }
        clearTimeout(leaveTimer.current);
        clearTimeout(closeAnimTimer.current);
        clearTimeout(collapseTimer.current);
        if (closingRailRef.current) {
          setClosingRail(false);
        }
        setSliver(false);
        if (target === "popover") {
          return;
        }
        const el = document.elementFromPoint(x, y);
        const ring = el?.closest<HTMLElement>("[data-rail-source]");
        const id = ring?.dataset.railSource as SourceId | undefined;
        if (id) {
          openRailSource(id, 70);
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

  // Size the hover popover with 22pt vertical shadow breathing room so drop shadows never clip.
  const railHoverHeight = useMemo(() => {
    if (hoveredRail === "workbuddy") return 252;
    if (hoveredRail === "codex") {
      const hasNextCredit = snapshot
        ? soonestUsableCredit(snapshot.credits, now) != null
        : false;
      const hasCredits =
        (snapshot?.availableCount != null && snapshot.availableCount > 0) ||
        hasNextCredit;
      return hasCredits ? (hasNextCredit ? 360 : 336) : 296;
    }
    if (hoveredRail === "antigravity") {
      const groups = antigravity.snapshot?.groups ?? [];
      if (groups.length === 0) return 252;
      const winCount = groups.reduce((sum, g) => sum + g.windows.length, 0);
      return Math.min(484, Math.max(300, 168 + groups.length * 24 + winCount * 47));
    }
    return 296;
  }, [hoveredRail, snapshot, now, antigravity.snapshot]);

  // Native rail hover renders inside a dedicated popover window, so the main rail strip never resizes or flickers.
  const mode: WindowMode = w.settings
    ? "settings"
    : selection
      ? "confirmation"
      : useRail
        ? !bridge.native && hoveredRail
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
        closeRailImmediately();
        back();
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [redeeming]);

  function openDashboardOrInline(tab: "usage" | "settings") {
    closeRailImmediately();
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

  const popoverActionsRef = useRef({
    refresh: async () => {
      await Promise.all([refreshAll(), todayUsage.refresh(true)]);
    },
    expand: (id: SourceId) => {
      closeRailImmediately();
      void w.update({ selectedSource: id, compact: false });
    },
    openDashboard: openDashboardOrInline,
    close: closeRailImmediately,
  });
  popoverActionsRef.current = {
    refresh: async () => {
      await Promise.all([refreshAll(), todayUsage.refresh(true)]);
    },
    expand: (id: SourceId) => {
      closeRailImmediately();
      void w.update({ selectedSource: id, compact: false });
    },
    openDashboard: openDashboardOrInline,
    close: closeRailImmediately,
  };

  // Receive button actions clicked inside the separate native rail-popover window.
  useEffect(() => {
    if (!bridge.native || !useRail) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void bridge
      .onRailPopoverAction((action) => {
        if (action.type === "refresh") void popoverActionsRef.current.refresh();
        else if (action.type === "expand") popoverActionsRef.current.expand(action.source);
        else if (action.type === "openDashboard")
          popoverActionsRef.current.openDashboard(action.tab);
        else if (action.type === "close") popoverActionsRef.current.close();
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

  // Synchronize the separate native rail-popover window whenever hover source, layout or live data changes.
  useEffect(() => {
    if (!bridge.native || !w.ready || !useRail) return;
    if (!hoveredRail) {
      if (popoverShownKeyRef.current !== null) {
        popoverShownKeyRef.current = null;
        popoverOpeningRef.current = false;
        pendingPopoverSyncRef.current = null;
        popoverSeqRef.current += 1;
        void bridge.hideRailPopover().catch(() => {});
      }
      return;
    }

    const payload: RailPopoverData = {
      source: hoveredRail,
      popoverSide: popoverSideRef.current,
      closing: closingRail,
      theme: preferences.theme,
      currency: preferences.currency,
      usdToCny: preferences.usdToCny,
      codex: snapshot,
      codexStatus: sources.codexStatus,
      workbuddy: {
        snapshot: wb.snapshot,
        error: wb.error,
      },
      antigravity: {
        snapshot: antigravity.snapshot,
        error: antigravity.error,
      },
      todayUsage: todayUsage.report,
      todayBusy: todayUsage.busy,
      now,
      etaMap,
      busy: visibleBusy,
    };

    const layoutKey = `${hoveredRail}:${railHoverHeight}:${preferences.railEdge}`;
    if (popoverShownKeyRef.current === layoutKey) {
      // Queue updates while the initial show/position call is still resolving its final side.
      if (popoverOpeningRef.current) {
        pendingPopoverSyncRef.current = payload;
        return;
      }
      void bridge.syncRailPopover(payload).catch(() => {});
      return;
    }

    const seq = ++popoverSeqRef.current;
    popoverShownKeyRef.current = layoutKey;
    popoverOpeningRef.current = true;
    pendingPopoverSyncRef.current = null;
    void bridge
      .showRailPopoverWindow(
        preferences.railEdge,
        railBaseHeight,
        railHoverHeight,
        payload,
      )
      .then((side) => {
        if (popoverSeqRef.current !== seq) {
          if (!hoveredRailRef.current) {
            void bridge.hideRailPopover().catch(() => {});
          }
          return;
        }
        popoverOpeningRef.current = false;
        popoverSideRef.current = side;
        const queued = pendingPopoverSyncRef.current;
        pendingPopoverSyncRef.current = null;
        if (queued) {
          void bridge
            .syncRailPopover({ ...queued, popoverSide: side })
            .catch(() => {});
        }
      })
      .catch((e) => {
        if (popoverSeqRef.current === seq) popoverOpeningRef.current = false;
        w.setError(String(e));
      });
  }, [
    w.ready,
    useRail,
    hoveredRail,
    closingRail,
    railHoverHeight,
    railBaseHeight,
    preferences.railEdge,
    preferences.theme,
    preferences.currency,
    preferences.usdToCny,
    snapshot,
    sources.codexStatus,
    wb.snapshot,
    wb.error,
    antigravity.snapshot,
    antigravity.error,
    todayUsage.report,
    todayUsage.busy,
    now,
    etaMap,
    visibleBusy,
  ]);

  if (useRail) {
    return (
      <RailView
        preferences={preferences}
        popoverSide={railLayout.popoverSide}
        railOffsetY={railLayout.railOffsetY}
        closing={closingRail}
        inlinePopover={!bridge.native}
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
          openRailSource(id, 80);
        }}
        onWake={() => {
          clearTimeout(collapseTimer.current);
          setSliver(false);
        }}
        onLeave={() => {
          scheduleRailClose(220);
        }}
        onDragStart={() => {
          suppressHoverDuringDrag();
          closeRailImmediately();
        }}
        onRefresh={async () => {
          await Promise.all([refreshAll(), todayUsage.refresh(true)]);
        }}
        onExpand={(id) => {
          closeRailImmediately();
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
