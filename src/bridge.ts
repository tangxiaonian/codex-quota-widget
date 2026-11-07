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
