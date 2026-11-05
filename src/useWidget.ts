import { useCallback, useEffect, useRef, useState } from "react";
import * as bridge from "./bridge";
import {
  defaults,
  type Preferences,
  type Snapshot,
  type Lifecycle,
} from "./model";

/** Own refresh scheduling and freshness; visual countdowns cannot call the consumption path. */
export function useWidget() {
  const [preferences, setPreferences] = useState(defaults);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [lifecycle, setLifecycle] = useState<Lifecycle>({
    running: true,
    sleeping: false,
    reduceTransparency: false,
  });
  const [ready, setReady] = useState(false),
    [demo, setDemo] = useState(false),
    [busy, setBusy] = useState(false),
    [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [settings, setSettings] = useState(false);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const pending = useRef(false),
    prefsRef = useRef(preferences),
    lifeRef = useRef(lifecycle),
    lastReset = useRef("");
  prefsRef.current = preferences;
  lifeRef.current = lifecycle;
  /** Merge simultaneous triggers into one in-flight read. */
  const refresh = useCallback(async () => {
    if (pending.current || lifeRef.current.sleeping) return;
    pending.current = true;
    setBusy(true);
    setFresh(false);
    try {
      const s = await bridge.refresh();
      setSnapshot(s);
      setFresh(true);
      setError(null);
    } catch (e) {
      const message = String(e);
      setError(message);
      if (/未登录|认证方式|账号已改变/.test(message)) setSnapshot(null);
    } finally {
      pending.current = false;
      setBusy(false);
      setNow(Math.floor(Date.now() / 1000));
    }
  }, []);
  /** Apply a settings change and persist a single coherent preferences object. */
  const update = useCallback(async (patch: Partial<Preferences>) => {
    const previous = prefsRef.current;
    const next = { ...previous, ...patch };
    prefsRef.current = next;
    setPreferences(next);
    try {
      await bridge.save(next);
      if (next.alwaysOnTop !== previous.alwaysOnTop)
        await bridge.pin(next.alwaysOnTop);
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    const cleanup: (() => void)[] = [];
    /** Bootstrap listeners before reads; all side effects stay within this widget. */
    async function start() {
      try {
        const b = await bridge.bootstrap();
        if (!mounted) return;
        prefsRef.current = b.preferences;
        lifeRef.current = b.lifecycle;
        setPreferences(b.preferences);
        setSnapshot(b.cached);
        setLifecycle(b.lifecycle);
        setDemo(!!b.demo);
        await bridge.restore(b.preferences);
        await bridge.pin(b.preferences.alwaysOnTop);
        setReady(true);
        await bridge.show(
          !b.preferences.followCodex || b.lifecycle.running || !!b.demo,
        );
        cleanup.push(
          await bridge.onLifecycle((state) => {
            const previous = lifeRef.current;
            lifeRef.current = state;
            setLifecycle(state);
            if (prefsRef.current.followCodex)
              void bridge.show(state.running && !state.sleeping);
            if (
              state.running &&
              !state.sleeping &&
              (!previous.running || previous.sleeping)
            )
              void refresh();
          }),
        );
        cleanup.push(
          await bridge.onMenu((action) => {
            if (action === "settings") setSettings(true);
            if (action === "refresh" || action === "show") void refresh();
          }),
        );
        if (b.lifecycle.running || !b.preferences.followCodex || b.demo)
          void refresh();
      } catch (e) {
        setError(String(e));
        setReady(true);
        await bridge.show(true);
      }
    }
    void start();
    return () => {
      mounted = false;
      cleanup.forEach((fn) => fn());
    };
  }, [refresh, update]);
  useEffect(() => {
    if (
      !ready ||
      !preferences.autoRefresh ||
      lifecycle.sleeping ||
      (!lifecycle.running && preferences.followCodex)
    )
      return;
    const timer = setInterval(
      () => void refresh(),
      preferences.refreshMinutes * 60_000,
    );
    return () => clearInterval(timer);
  }, [
    ready,
    preferences.autoRefresh,
    preferences.refreshMinutes,
    preferences.followCodex,
    lifecycle.running,
    lifecycle.sleeping,
    refresh,
  ]);
  useEffect(() => {
    if (!ready || lifecycle.sleeping) return;
    const timer = setInterval(async () => {
      if (await bridge.isVisible()) setNow(Math.floor(Date.now() / 1000));
    }, 30_000);
    return () => clearInterval(timer);
  }, [ready, lifecycle.sleeping]);
  useEffect(() => {
    if (
      !ready ||
      !snapshot ||
      !fresh ||
      !preferences.autoRefresh ||
      lifecycle.sleeping ||
      (!lifecycle.running && preferences.followCodex)
    )
      return;
    const due = snapshot.windows
      .filter((w) => w.resetsAt != null && w.resetsAt <= now)
      .map((w) => w.resetsAt)
      .join(",");
    const key = snapshot.account.key + due;
    if (due && lastReset.current !== key) {
      lastReset.current = key;
      void refresh();
    }
  }, [
    now,
    snapshot,
    ready,
    fresh,
    preferences.autoRefresh,
    preferences.followCodex,
    lifecycle.running,
    lifecycle.sleeping,
    refresh,
  ]);
  return {
    preferences,
    snapshot,
    lifecycle,
    ready,
    demo,
    busy,
    fresh,
    error,
    notice,
    settings,
    now,
    refresh,
    update,
    setSettings,
    setError,
    setNotice,
  };
}

export type WidgetState = ReturnType<typeof useWidget>;
