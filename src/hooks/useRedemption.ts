import { useState } from "react";
import * as bridge from "../bridge";
import { outcomeMessage, type Credit } from "../model";
import type { WidgetState } from "../useWidget";
export type Selection = {
  credit: Credit;
  accountKey: string;
  email: string;
  attemptId: string;
};
/** Own the explicit select-confirm-refresh flow; timers have no access to the consume handler. */
export function useRedemption(w: WidgetState) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const { snapshot } = w;
  /** Capture the account and credit at selection time, not when a later render happens. */
  function choose(credit: Credit) {
    if (!snapshot || !w.fresh || w.busy) return;
    setSelection({
      credit,
      accountKey: snapshot.account.key,
      email: snapshot.account.email ?? "当前账号",
      attemptId: crypto.randomUUID(),
    });
    w.setNotice(null);
  }
  /** This is the sole UI handler that invokes consume; no lifecycle or timer calls it. */
  async function confirm() {
    if (!selection || redeeming || w.busy || !w.fresh) return;
    setRedeeming(true);
    w.setError(null);
    try {
      const result = await bridge.consume(
        selection.accountKey,
        selection.credit.id,
        selection.attemptId,
      );
      w.setNotice(outcomeMessage(result));
      setSelection(null);
      await w.refresh();
    } catch (e) {
      w.setError(String(e));
      setSelection(null);
      await w.refresh();
      w.setError(String(e));
    } finally {
      setRedeeming(false);
    }
  }
  return {
    selection,
    redeeming,
    choose,
    confirm,
    cancel: () => setSelection(null),
  };
}
