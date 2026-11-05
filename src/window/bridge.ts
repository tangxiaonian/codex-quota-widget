import { invoke } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  availableMonitors,
  currentMonitor,
  primaryMonitor,
} from "@tauri-apps/api/window";
import type { Preferences, WindowSize } from "../model";
import { restoreFrame, fitSize, type WindowMode } from "./geometry";
const native = "__TAURI_INTERNALS__" in window;

/** Apply mode-specific constraints before resizing; the mini bar may be shorter than expanded minimums. */
export async function applyWindowMode(
  mode: WindowMode,
  preferred: WindowSize,
): Promise<void> {
  if (!native) return;
  const win = getCurrentWindow();
  const monitor = await currentMonitor();
  // Capture the anchor before AppKit resizes or changes the window style mask.
  const position = await win.outerPosition();
  const size = fitSize(preferred, monitor);
  await win.setMinSize(new LogicalSize(330, mode === "compact" ? 104 : 260));
  await win.setSize(new LogicalSize(size.width, size.height));
  await win.setResizable(mode !== "compact");
  // Growing near a screen edge must keep settings and confirmation buttons reachable.
  if (monitor) {
    const frame = restoreFrame(position, size, [monitor], monitor);
    await win.setPosition(new PhysicalPosition(frame.x, frame.y));
  }
}

/** Restore to any connected display, including negative coordinates; clamp to its usable work area. */
export async function restore(preferences: Preferences): Promise<void> {
  if (!native) return;
  const monitors = await availableMonitors();
  const fallback = (await primaryMonitor()) ?? monitors[0];
  if (!fallback) return;
  const size = preferences.compact
    ? { width: 360, height: 104 }
    : (preferences.expandedSize ?? { width: 368, height: 524 });
  const frame = restoreFrame(preferences, size, monitors, fallback);
  const win = getCurrentWindow();
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
