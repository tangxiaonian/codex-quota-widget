import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as bridge from "../bridge";
import { useTheme } from "../hooks/useTheme";
import { RailHoverCard, type RailPopoverData } from "./RailHoverCard";

/** Standalone transparent window hosting only the side-rail hover detail card. */
export function RailPopoverApp() {
  const [state, setState] = useState<RailPopoverData | null>(null);
  const revealedOpenIdRef = useRef<number | null>(null);
  useTheme(state?.theme ?? "system");

  useEffect(() => {
    let disposed = false;
    let stopState: (() => void) | undefined;
    let stopClear: (() => void) | undefined;
    void bridge
      .getRailPopoverState()
      .then((initial) => {
        if (!disposed && initial) setState(initial);
      })
      .catch(() => {});
    void bridge
      .onRailPopoverState((next) => {
        if (!disposed) setState(next);
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stopState = unlisten;
      })
      .catch(() => {});
    void bridge
      .onRailPopoverClear(() => {
        if (!disposed) {
          revealedOpenIdRef.current = null;
          setState(null);
        }
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stopClear = unlisten;
      })
      .catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void bridge.emitRailPopoverAction({ type: "close" });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      disposed = true;
      stopState?.();
      stopClear?.();
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Wait until the new DOM is laid out before revealing the hidden native window so stale pixels never flash first.
  useLayoutEffect(() => {
    const openId = state?.openId;
    if (!state || state.closing || openId == null) return;
    if (revealedOpenIdRef.current === openId) return;
    revealedOpenIdRef.current = openId;
    void document.body.offsetHeight;
    const timer = setTimeout(() => {
      void bridge.revealRailPopover(openId).catch(() => {});
    }, 16);
    return () => clearTimeout(timer);
  }, [state?.openId, state?.closing]);

  if (!state) return null;

  return (
    <main className="rail-popover-window">
      <RailHoverCard
        {...state}
        onRefresh={() => void bridge.emitRailPopoverAction({ type: "refresh" })}
        onExpand={(source) =>
          void bridge.emitRailPopoverAction({ type: "expand", source })
        }
        onOpenDashboard={(tab) =>
          void bridge.emitRailPopoverAction({ type: "openDashboard", tab })
        }
      />
    </main>
  );
}
