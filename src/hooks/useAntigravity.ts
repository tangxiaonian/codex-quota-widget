import { useCallback, useEffect, useRef, useState } from "react";
import { onMenu, refreshAntigravity } from "../bridge";
import type { Lifecycle, Preferences } from "../model";
import type { AntigravitySnapshot } from "../antigravity";

/** Provide simulated group and reset data for browser and native demos. */
function demoSnapshot(): AntigravitySnapshot {
  const now = Math.floor(Date.now() / 1000);
  const windows = (session: number, weekly: number) => [
    {
      id: "session",
      kind: "session",
      name: "Session",
      remaining: session,
      resetsAt: now + 7200,
    },
    {
      id: "weekly",
      kind: "weekly",
      name: "Weekly",
      remaining: weekly,
      resetsAt: now + 3 * 86400,
    },
  ];
  return {
    groups: [
      { name: "Gemini Models", windows: windows(68, 24) },
      { name: "Claude and GPT Models", windows: windows(80, 57) },
    ],
    fetchedAt: now,
    plan: "Pro",
    source: "languageServer",
  };
}

/** Schedule Antigravity independently and deduplicate timer, menu and button reads. */
export function useAntigravity(
  ready: boolean,
  demo: boolean,
  prefs: Preferences,
  life: Lifecycle,
) {
  const [snapshot, setSnapshot] = useState<AntigravitySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const active = ready && prefs.antigravityEnabled && !life.sleeping;
  const refresh = useCallback(async () => {
    if (!active || pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      setSnapshot(demo ? demoSnapshot() : await refreshAntigravity());
      setError(null);
    } catch (e) {
      // Clear stale figures when neither the desktop language server nor `agy` can confirm current quota.
      setSnapshot(null);
      if (typeof e === "string" && e.trim()) {
        setError(e);
      } else if (e instanceof Error && e.message) {
        setError(e.message);
      } else {
        setError("无法读取 Antigravity 额度");
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [active, demo]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void refresh();
    if (prefs.autoRefresh) {
      const timer = setInterval(
        () => void refresh(),
        prefs.refreshMinutes * 60000,
      );
      return () => clearInterval(timer);
    }
  }, [
    active,
    life.antigravityRunning,
    prefs.autoRefresh,
    prefs.refreshMinutes,
    refresh,
  ]);

  useEffect(() => {
    if (!active) {
      return;
    }
    let disposed = false;
    let stop: (() => void) | undefined;
    void onMenu((action) => {
      if (action === "refresh" || action === "show") {
        void refresh();
      }
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          stop = unlisten;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, [active, refresh]);

  return { snapshot, busy, error, refresh };
}
export type AntigravityState = ReturnType<typeof useAntigravity>;
