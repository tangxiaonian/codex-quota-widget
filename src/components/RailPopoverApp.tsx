import { useEffect, useState } from "react";
import * as bridge from "../bridge";
import { useTheme } from "../hooks/useTheme";
import { RailHoverCard, type RailPopoverData } from "./RailHoverCard";

/** Standalone transparent window hosting only the side-rail hover detail card. */
export function RailPopoverApp() {
  const [state, setState] = useState<RailPopoverData | null>(null);
  useTheme(state?.theme ?? "system");

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
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
        else stop = unlisten;
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
      stop?.();
      document.removeEventListener("keydown", onKey);
    };
  }, []);

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
