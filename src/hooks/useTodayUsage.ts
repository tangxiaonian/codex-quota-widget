import { useCallback, useEffect, useRef, useState } from "react";
import * as bridge from "../bridge";
import type { UsageReport } from "../usageTypes";

const MIN_SCAN_GAP_MS = 60_000;

/**
 * Incrementally load today's local Token usage in the background for the rail popover.
 * Throttled so hovering across rings reads instantly from memory without re-scanning disk.
 */
export function useTodayUsage(enabled: boolean, sleeping: boolean) {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const lastFetched = useRef(0);

  const refresh = useCallback(
    async (force = false) => {
      if (!enabled || sleeping || pending.current) return;
      const now = Date.now();
      if (!force && now - lastFetched.current < MIN_SCAN_GAP_MS) return;
      pending.current = true;
      setBusy(true);
      try {
        const next = await bridge.scanUsageReport(1);
        setReport(next);
        lastFetched.current = Date.now();
      } catch {
        // Keep previous cached reading; hover popover treats missing usage gracefully.
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [enabled, sleeping],
  );

  useEffect(() => {
    if (!enabled || sleeping) return;
    void refresh(false);
  }, [enabled, sleeping, refresh]);

  return { report, busy, refresh };
}
