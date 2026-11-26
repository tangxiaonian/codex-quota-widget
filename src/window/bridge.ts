import { invoke } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  availableMonitors,
  currentMonitor,
  primaryMonitor,
} from "@tauri-apps/api/window";
import {
  compactHeight,
  sourceOptions,
  type Preferences,
  type RailEdge,
  type WindowSize,
} from "../model";
import {
  fitSize,
  isRailMode,
  RAIL_POPOVER_WINDOW_WIDTH,
  RAIL_WIDTH,
  railFrame,
  railHeight,
  railHoverFrame,
  railPopoverFrame,
  restoreFrame,
  snapRailPosition,
  type WindowMode,
} from "./geometry";
import type { RailHoverLayout } from "./controller";
import type { RailPopoverData } from "../components/RailHoverCard";

const native = "__TAURI_INTERNALS__" in window;
let lastChromeRectangular: boolean | null = null;

/** Toggle Tauri's rectangular window-level vibrancy & shadow (disabled in rail modes), skipping redundant native resets. */
export async function setWindowChrome(rectangular: boolean): Promise<void> {
  if (!native || lastChromeRectangular === rectangular) return;
  lastChromeRectangular = rectangular;
  await invoke("set_window_chrome", { rectangular });
}

/** Pre-create the hidden popover WebView so the first hover opens without cold-start delay. */
export async function prewarmRailPopover(): Promise<void> {
  if (native) await invoke("prewarm_rail_popover");
}

/** Position and show the dedicated rail-popover window beside the stationary rail strip. */
export async function showRailPopoverWindow(
  preferredEdge: RailEdge,
  railHeightPx: number,
  popoverHeightPx: number,
  state: RailPopoverData,
): Promise<RailEdge> {
  if (!native) return state.popoverSide;
  const win = getCurrentWindow();
  const monitors = await availableMonitors();
  const monitor =
    (await currentMonitor()) ?? (await primaryMonitor()) ?? monitors[0];
  const position = await win.outerPosition();
  if (!monitor) {
    await invoke("sync_rail_popover", { state });
    return state.popoverSide;
  }
  const list = monitors.length ? monitors : [monitor];
  const frame = railPopoverFrame(
    position,
    preferredEdge,
    { width: RAIL_WIDTH, height: railHeightPx },
    { width: RAIL_POPOVER_WINDOW_WIDTH, height: popoverHeightPx },
    list,
    monitor,
  );
  const nextState: RailPopoverData = {
    ...state,
    popoverSide: frame.popoverSide,
  };
  await invoke("show_rail_popover", {
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    state: nextState,
  });
  return frame.popoverSide;
}

/** Push state updates (live refresh or close fade) to the separate popover window without moving it. */
export async function syncRailPopover(state: RailPopoverData): Promise<void> {
  if (native) await invoke("sync_rail_popover", { state });
}

/** Hide the separate rail-popover window without touching the main rail strip window. */
export async function hideRailPopover(): Promise<void> {
  if (native) await invoke("hide_rail_popover");
}

/** Atomically apply size, position and constraints in one AppKit transaction. */
async function commitFrame(
  currentPos: { x: number; y: number },
  targetPos: { x: number; y: number },
  size: WindowSize,
  scale: number,
  minWidth: number,
  minHeight: number,
  resizable: boolean,
): Promise<void> {
  await invoke("resize_window_anchored", {
    deltaX: (targetPos.x - currentPos.x) / scale,
    deltaTopY: (targetPos.y - currentPos.y) / scale,
    width: size.width,
    height: size.height,
    minWidth,
    minHeight,
    resizable,
  });
}

/** Apply mode-specific constraints before resizing; rail modes update frame atomically to avoid flicker. */
export async function applyWindowMode(
  mode: WindowMode,
  preferred: WindowSize,
  railEdge: RailEdge = "right",
  railAnchor?: { x: number | null; y: number | null },
  railBaseHeight?: number,
): Promise<RailHoverLayout | void> {
  if (!native) return;
  const win = getCurrentWindow();
  const monitors = await availableMonitors();
  const monitor = (await currentMonitor()) ?? (await primaryMonitor()) ?? monitors[0];
  const position = await win.outerPosition();
  const size = fitSize(preferred, monitor);
  const rail = isRailMode(mode);

  await setWindowChrome(!rail);

  const minWidth = rail ? 12 : 330;
  const minHeight = rail ? 48 : mode === "compact" ? 104 : 260;
  const resizable = !rail && mode !== "compact";

  if (!monitor) {
    await win.setMinSize(new LogicalSize(minWidth, minHeight));
    await win.setSize(new LogicalSize(size.width, size.height));
    await win.setResizable(resizable);
    return;
  }

  const scale = monitor.scaleFactor || 1;
  const list = monitors.length ? monitors : [monitor];

  if (mode === "railHover") {
    const anchor =
      railAnchor && railAnchor.x != null && railAnchor.y != null
        ? railAnchor
        : position;
    const hover = railHoverFrame(
      anchor,
      railEdge,
      { width: RAIL_WIDTH, height: railBaseHeight ?? 150 },
      size,
      list,
      monitor,
    );
    await commitFrame(position, hover, size, scale, minWidth, minHeight, false);
    return { popoverSide: hover.popoverSide, railOffsetY: hover.railOffsetY };
  }

  if (mode === "rail") {
    const frame =
      railAnchor && railAnchor.x != null && railAnchor.y != null
        ? restoreFrame(railAnchor, size, list, monitor)
        : railFrame(railEdge, position, size, list, monitor, 0);
    await commitFrame(position, frame, size, scale, minWidth, minHeight, false);
    return;
  }

  if (mode === "railSliver") {
    const frame = railFrame(
      railEdge,
      railAnchor ?? position,
      size,
      list,
      monitor,
      0,
    );
    await commitFrame(position, frame, size, scale, minWidth, minHeight, false);
    return;
  }

  const frame = restoreFrame(position, size, [monitor], monitor);
  await commitFrame(position, frame, size, scale, minWidth, minHeight, resizable);
}

/** Snap a freely dragged rail only when released close to the left or right display edge. */
export async function snapRail(
  position: { x: number; y: number },
  size: WindowSize,
): Promise<{ x: number; y: number; snappedEdge: RailEdge | null }> {
  if (!native) return { x: position.x, y: position.y, snappedEdge: null };
  const monitors = await availableMonitors();
  const fallback = (await currentMonitor()) ?? (await primaryMonitor()) ?? monitors[0];
  if (!fallback) return { x: position.x, y: position.y, snappedEdge: null };
  const snapped = snapRailPosition(
    position,
    size,
    monitors.length ? monitors : [fallback],
    fallback,
  );
  if (snapped.x !== position.x || snapped.y !== position.y) {
    await getCurrentWindow().setPosition(
      new PhysicalPosition(snapped.x, snapped.y),
    );
  }
  return snapped;
}

/** Restore to any connected display, including negative coordinates; clamp to its usable work area. */
export async function restore(preferences: Preferences): Promise<void> {
  if (!native) return;
  const monitors = await availableMonitors();
  const fallback = (await primaryMonitor()) ?? monitors[0];
  if (!fallback) return;

  const win = getCurrentWindow();
  const enabledCount = sourceOptions.filter((s) => preferences[s.enabled]).length;
  const useRail = preferences.compact && preferences.desktopMode === "rail";

  await setWindowChrome(!useRail);

  if (useRail) {
    const size = { width: RAIL_WIDTH, height: railHeight(enabledCount) };
    const frame =
      preferences.x != null && preferences.y != null
        ? restoreFrame(preferences, size, monitors, fallback)
        : railFrame(preferences.railEdge, preferences, size, monitors, fallback, 0);
    await win.setMinSize(new LogicalSize(12, 48));
    await win.setSize(new LogicalSize(frame.width, frame.height));
    await win.setPosition(new PhysicalPosition(frame.x, frame.y));
    return;
  }

  const size = preferences.compact
    ? { width: 360, height: compactHeight(preferences) }
    : (preferences.expandedSize ?? { width: 368, height: 524 });
  const frame = restoreFrame(preferences, size, monitors, fallback);
  await win.setMinSize(new LogicalSize(330, preferences.compact ? 104 : 260));
  await win.setSize(new LogicalSize(frame.width, frame.height));
  await win.setPosition(new PhysicalPosition(frame.x, frame.y));
}

/** Lifecycle hiding also suspends parking and its indicator; showing stays passive. */
export async function show(visible: boolean): Promise<void> {
  if (!native) return;
  if (visible) await getCurrentWindow().show();
  else {
    await disarmTopHide();
    await hideRailPopover();
    await getCurrentWindow().hide();
  }
}
/** Change window level only when the pin preference changes. */
export async function pin(value: boolean): Promise<void> {
  if (native) await getCurrentWindow().setAlwaysOnTop(value);
}
/** The native module checks the owning display and decides whether a compact drag should park. */
export async function armTopHide(): Promise<void> {
  if (native) await invoke("arm_top_hide");
}
/** Restore opacity and input as well as stopping both parking timers. */
export async function disarmTopHide(): Promise<void> {
  if (native) await invoke("disarm_top_hide");
}
/** Header-only native dragging leaves controls selectable. */
export function drag(): void {
  if (native) void getCurrentWindow().startDragging();
}
/** Report OS visibility for countdown scheduling. */
export async function isVisible(): Promise<boolean> {
  return !native || getCurrentWindow().isVisible();
}
/** Window positions are physical pixels, including negative secondary-display coordinates. */
export async function onMove(fn: (x: number, y: number) => void) {
  return native
    ? getCurrentWindow().onMoved((e) => fn(e.payload.x, e.payload.y))
    : () => {};
}
/** Convert native resize events to logical units before persistence. */
export async function onResize(fn: (size: WindowSize) => void) {
  return native
    ? getCurrentWindow().onResized((e) => {
        const scale = window.devicePixelRatio;
        fn({
          width: Math.round(e.payload.width / scale),
          height: Math.round(e.payload.height / scale),
        });
      })
    : () => {};
}
/** Delegate edge gestures to the OS rather than polling the pointer. */
export async function resizeDrag(
  direction:
    | "North"
    | "South"
    | "East"
    | "West"
    | "NorthEast"
    | "NorthWest"
    | "SouthEast"
    | "SouthWest",
): Promise<void> {
  if (native) await getCurrentWindow().startResizeDragging(direction);
}
