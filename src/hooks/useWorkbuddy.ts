import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { native, onMenu } from "../bridge";
import { sourceRunning, type Lifecycle, type Preferences } from "../model";
import type { WorkbuddySnapshot, WorkbuddyState } from "../workbuddyTypes";
const fixture: WorkbuddySnapshot = {
  accountKey: "demo-workbuddy",
  name: "alex@example.com",
  plan: "Pro",
  remaining: 12480,
  total: 50000,
  used: 37520,
  packageError: null,
  packages: [
    {
      id: "plan",
      name: "套餐积分",
      remaining: 10000,
      total: 40000,
      expiresAt: null,
    },
    {
      id: "bonus",
      name: "赠送积分",
      remaining: 2480,
      total: 10000,
      expiresAt: Math.floor(Date.now() / 1000) + 19 * 86400,
    },
  ],
  fetchedAt: Math.floor(Date.now() / 1000),
};
/** Own WorkBuddy's read loop and stale data independently from Codex and its consumption flow. */
export function useWorkbuddy(
  ready: boolean,
  demo: boolean,
  prefs: Preferences,
  life: Lifecycle,
): WorkbuddyState {
  const [snapshot, setSnapshot] = useState<WorkbuddySnapshot | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const accountKey = useRef<string | null>(null);
  const pending = useRef(false),
    mounted = useRef(true);
  const current = useRef({ prefs, life });
  current.current = { prefs, life };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (
      pending.current ||
      !current.current.prefs.workbuddyEnabled ||
      current.current.life.sleeping
    )
      return;
    pending.current = true;
    setBusy(true);
    try {
      const result =
        demo || !native
          ? { ...fixture, fetchedAt: Math.floor(Date.now() / 1000) }
          : await invoke<WorkbuddySnapshot>("refresh_workbuddy", {
              expectedAccountKey: accountKey.current,
            });
      if (mounted.current) {
        accountKey.current = result.accountKey;
        setSnapshot(result);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) {
        setError(String(e));
        if (/登录|账号|安装/.test(String(e))) {
          accountKey.current = null;
          setSnapshot(null);
        }
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [demo]);
  useEffect(() => {
    if (
      !ready ||
      !prefs.workbuddyEnabled ||
      life.sleeping ||
      (prefs.followCodex && !sourceRunning(life, prefs))
    )
      return;
    void refresh();
    if (!prefs.autoRefresh) return;
    const timer = setInterval(
      () => void refresh(),
      prefs.refreshMinutes * 60000,
    );
    return () => clearInterval(timer);
  }, [
    ready,
    prefs.workbuddyEnabled,
    prefs.autoRefresh,
    prefs.refreshMinutes,
    life.sleeping,
    life.workbuddyRunning,
    life.antigravityRunning,
    life.running,
    prefs.followCodex,
    prefs.codexEnabled,
    prefs.antigravityEnabled,
    refresh,
  ]);
  useEffect(() => {
    if (!ready) return;
    let disposed = false,
      stop: (() => void) | undefined;
    void onMenu((action) => {
      if (action === "refresh" || action === "show") void refresh();
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [ready, refresh]);
  return { snapshot, busy, error, refresh };
}
