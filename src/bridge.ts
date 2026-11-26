import { invoke } from "@tauri-apps/api/core";
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
import type { AntigravitySnapshot } from "./antigravity";
import type {
  RailPopoverAction,
  RailPopoverData,
} from "./components/RailHoverCard";
import { demoUsageReport, type UsageReport } from "./usageTypes";
export const native = "__TAURI_INTERNALS__" in window;
let sample = demoSnapshot();
let demo = !native || new URLSearchParams(location.search).has("demo");
/** Initialize native storage separately from demo mode, which never reads live account APIs. */
export async function bootstrap(): Promise<Bootstrap> {
  if (!native)
    return {
      preferences: {
        ...defaults,
        antigravityEnabled: true,
        ...JSON.parse(localStorage.getItem("widget-demo-prefs") || "{}"),
      },
      cached: sample,
      lifecycle: { running: true, sleeping: false, reduceTransparency: false },
      demo: true,
    };
  const state = await invoke<Bootstrap>("bootstrap");
  demo ||= !!state.demo;
  return demo
    ? {
        ...state,
        preferences: { ...defaults, antigravityEnabled: true },
        cached: sample,
        demo: true,
      }
    : state;
}
/** Only this read command is used by timers, native events and the refresh button. */
export async function refresh(): Promise<Snapshot> {
  return demo
    ? { ...sample, fetchedAt: Math.floor(Date.now() / 1000) }
    : invoke<Snapshot>("refresh_snapshot");
}
/** Read Antigravity quota from the local language server or official `agy` CLI. */
export function refreshAntigravity(): Promise<AntigravitySnapshot> {
  return invoke("refresh_antigravity");
}
/** Demo dates are relative to the fixture; the native command exposes only the account's date. */
export async function subscriptionUntil(
  accountKey: string,
): Promise<number | null> {
  if (demo)
    return accountKey === sample.account.key
      ? sample.fetchedAt + 23 * 86400
      : null;
  return invoke("subscription_active_until", { accountKey });
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
/** Update the macOS menu-bar status title beside the tray icon. */
export async function setTrayTitle(title: string): Promise<void> {
  if (!native || demo) return;
  await invoke("set_tray_title", { title });
}
/** Sync saved preferences across the floating card and the dashboard window. */
export async function onPreferencesUpdated(
  fn: (preferences: Preferences) => void,
) {
  return native
    ? listen<Preferences>("preferences-updated", (e) => fn(e.payload))
    : () => {};
}
export interface RailPointerEvent {
  inside: boolean;
  target: "rail" | "popover" | "none";
  x: number;
  y: number;
}

/** Listen for native mouse coordinates over the floating rail and popover windows even when unfocused. */
export async function onRailPointer(fn: (event: RailPointerEvent) => void) {
  return native
    ? listen<RailPointerEvent>("rail-pointer", (e) => fn(e.payload))
    : () => {};
}
/** Read the cached popover payload when the dedicated rail-popover WebView mounts. */
export async function getRailPopoverState(): Promise<RailPopoverData | null> {
  if (!native) return null;
  return invoke<RailPopoverData | null>("get_rail_popover_state");
}
/** Subscribe to live state pushes inside the dedicated rail-popover window. */
export async function onRailPopoverState(fn: (state: RailPopoverData) => void) {
  return native
    ? listen<RailPopoverData>("rail-popover-state", (e) => fn(e.payload))
    : () => {};
}
/** Send user actions clicked inside the dedicated rail-popover window back to the main window. */
export async function emitRailPopoverAction(
  action: RailPopoverAction,
): Promise<void> {
  if (!native) return;
  await invoke("rail_popover_action", { action });
}
/** Handle actions forwarded from the dedicated rail-popover window in the main window. */
export async function onRailPopoverAction(
  fn: (action: RailPopoverAction) => void,
) {
  return native
    ? listen<RailPopoverAction>("rail-popover-action", (e) => fn(e.payload))
    : () => {};
}
/** Open or focus the separate dashboard window (usage analytics & settings). */
export async function openDashboard(tab: "usage" | "settings"): Promise<void> {
  if (!native) return;
  await invoke("open_dashboard", { tab });
}
/** Listen for tab-switch instructions sent from the tray menu or floating rail. */
export async function onDashboardTab(fn: (tab: "usage" | "settings") => void) {
  return native
    ? listen<string>("dashboard-tab", (e) =>
        fn(e.payload === "settings" ? "settings" : "usage"),
      )
    : () => {};
}
/** Scan local Codex / WorkBuddy / Antigravity session files incrementally. */
export async function scanUsageReport(
  days: number | null,
): Promise<UsageReport> {
  return !native || demo
    ? demoUsageReport(days)
    : invoke<UsageReport>("scan_usage_report", { days });
}
/** Clear cached local usage rollups without touching preferences or snapshots. */
export async function clearUsageCache(): Promise<void> {
  if (!native || demo) return;
  await invoke("clear_usage_cache");
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

export * from "./window/bridge";
