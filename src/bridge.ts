import { invoke } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  primaryMonitor,
} from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import * as autostart from "@tauri-apps/plugin-autostart";
import {
  defaults,
  demoSnapshot,
  type Bootstrap,
  type Preferences,
  type Snapshot,
  type Lifecycle,
} from "./model";
export const native = "__TAURI_INTERNALS__" in window;
let sample = demoSnapshot();
let demo = !native || new URLSearchParams(location.search).has("demo");
/** Initialize native storage separately from demo mode, which never reads live account APIs. */
export async function bootstrap(): Promise<Bootstrap> {
  if (!native)
    return {
      preferences: {
        ...defaults,
        ...JSON.parse(localStorage.getItem("widget-demo-prefs") || "{}"),
      },
      cached: sample,
      lifecycle: { running: true, sleeping: false, reduceTransparency: false },
      demo: true,
    };
  const state = await invoke<Bootstrap>("bootstrap");
  demo ||= !!state.demo;
  return demo
    ? { ...state, preferences: { ...defaults }, cached: sample, demo: true }
    : state;
}
/** Only this read command is used by timers, native events and the refresh button. */
export async function refresh(): Promise<Snapshot> {
  return demo
    ? { ...sample, fetchedAt: Math.floor(Date.now() / 1000) }
    : invoke<Snapshot>("refresh_snapshot");
}
/** Production consumption is reachable solely through explicit confirmation. Demo stays local. */
export async function consume(
  accountKey: string,
  creditId: string,
  attemptId: string,
): Promise<string> {
  if (demo) {
    if (accountKey !== sample.account.key) throw new Error("演示账号已改变");
    if (!sample.credits.some((c) => c.id === creditId)) return "noCredit";
    sample = {
      ...sample,
      availableCount: Math.max(0, (sample.availableCount ?? 0) - 1),
      credits: sample.credits.filter((c) => c.id !== creditId),
      windows: sample.windows.map((w) =>
        w.minutes === 300 ? { ...w, usedPercent: 0 } : w,
      ),
    };
    return "reset";
  }
  return invoke("consume_credit", { accountKey, creditId, attemptId });
}
/** Save only view preferences; demo browser storage cannot affect the installed app. */
export async function save(preferences: Preferences): Promise<void> {
  if (!native || demo) {
    localStorage.setItem("widget-demo-prefs", JSON.stringify(preferences));
    return;
  }
  await invoke("save_preferences", { preferences });
}
/** Apply a view's preferred size only on view transitions, never on data refresh. */
export async function resize(width: number, height: number): Promise<void> {
  if (native) await getCurrentWindow().setSize(new LogicalSize(width, height));
}
/** Restore screen position if still visible; otherwise place the widget at the current screen edge. */
export async function restore(preferences: Preferences): Promise<void> {
  if (!native) return;
  const monitor = await primaryMonitor();
  if (!monitor) return;
  const { x, y } = preferences;
  const visible =
    x != null &&
    y != null &&
    x >= monitor.position.x &&
    y >= monitor.position.y &&
    x < monitor.position.x + monitor.size.width - 80 &&
    y < monitor.position.y + monitor.size.height - 80;
  await getCurrentWindow().setPosition(
    new PhysicalPosition(
      visible
        ? x
        : monitor.position.x + monitor.size.width - 470 * monitor.scaleFactor,
      visible ? y : monitor.position.y + 80 * monitor.scaleFactor,
    ),
  );
}
/** Showing from Codex lifecycle does not request focus. */
export async function show(visible: boolean): Promise<void> {
  if (native) {
    if (visible) await getCurrentWindow().show();
    else await getCurrentWindow().hide();
  }
}
/** Apply the pin preference without changing other windows. */
export async function pin(value: boolean): Promise<void> {
  if (native) await getCurrentWindow().setAlwaysOnTop(value);
}

/**
 * Toggle the native NSWindow resizable mask. CSS can only hide our custom
 * edges; macOS would still allow frameless edge resizing, so the mode must
 * flip the system-level flag: mini bar fixed, expanded freely resizable.
 */
export async function setResizable(enabled: boolean): Promise<void> {
  if (native) await getCurrentWindow().setResizable(enabled);
}

/**
 * Park the compact mini bar at the screen top: the native layer animates it up
 * behind the menu bar and watches the cursor to slide it back on hover.
 */
export async function armTopHide(): Promise<void> {
  if (native) await invoke("arm_top_hide");
}

/** Stop the cursor watcher when leaving the compact mode; window position is untouched. */
export async function disarmTopHide(): Promise<void> {
  if (native) await invoke("disarm_top_hide");
}

/** Window top edge in logical points below the screen top; null when unavailable.
 * Uses the window's own backing scale, NOT the cursor's monitor: with a second
 * display the cursor often sits elsewhere and would corrupt the conversion. */
export async function outerTopLogical(): Promise<number | null> {
  if (!native) return null;
  try {
    const pos = await getCurrentWindow().outerPosition();
    return pos.y / (window.devicePixelRatio || 2);
  } catch {
    return null;
  }
}
/** Drag is initiated only from the header, leaving controls and selection clickable. */
export function drag(): void {
  if (native) void getCurrentWindow().startDragging();
}
/** Register a typed native lifecycle listener. */
export async function onLifecycle(fn: (state: Lifecycle) => void) {
  return native
    ? listen<Lifecycle>("codex-state", (e) => fn(e.payload))
    : () => {};
}
/** Menu commands remain accessible when the compact card hides the toolbar. */
export async function onMenu(fn: (action: string) => void) {
  return native
    ? listen<string>("menu-action", (e) => fn(e.payload))
    : () => {};
}
/** Report OS visibility, not merely React mount state. */
export async function isVisible() {
  return !native || getCurrentWindow().isVisible();
}
/** Track physical window coordinates for subsequent launch. */
export async function onMove(fn: (x: number, y: number) => void) {
  return native
    ? getCurrentWindow().onMoved((e) => fn(e.payload.x, e.payload.y))
    : () => {};
}
/** OS registration status is distinct from a saved user preference. */
export async function loginStatus(): Promise<boolean> {
  return native && !demo ? autostart.isEnabled() : false;
}
/** Register autostart only after an explicit settings action; never during bootstrap. */
export async function loginToggle(enabled: boolean): Promise<void> {
  if (native && !demo) {
    if (enabled) await autostart.enable();
    else await autostart.disable();
  }
}

/** Let the OS perform frameless edge dragging; do not emulate pointer movement with polling. */
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
