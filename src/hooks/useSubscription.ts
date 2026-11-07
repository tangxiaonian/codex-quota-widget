import { useEffect, useState } from "react";
import * as bridge from "../bridge";
import { subscriptionText } from "../subscription";
import type { Snapshot } from "../model";

/** Look up the current snapshot's date on refresh or opt-in; late results from a prior account are discarded. */
export function useSubscription(
  enabled: boolean,
  snapshot: Snapshot | null,
  now: number,
) {
  const [result, setResult] = useState<{
    snapshot: Snapshot;
    until: number | null;
  } | null>(null);
  useEffect(() => {
    if (!enabled || !snapshot) {
      setResult(null);
      return;
    }
    let active = true;
    void bridge
      .subscriptionUntil(snapshot.account.key)
      .then((until) => {
        if (active) setResult({ snapshot, until });
      })
      .catch(() => {
        if (active) setResult(null);
      });
    return () => {
      active = false;
    };
  }, [enabled, snapshot]);
  return enabled && result && result.snapshot === snapshot
    ? subscriptionText(result.until, now)
    : null;
}
