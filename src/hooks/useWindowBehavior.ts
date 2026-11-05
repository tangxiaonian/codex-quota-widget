import { useEffect, useRef } from "react";
import * as bridge from "../bridge";
import type { Preferences } from "../model";
import { WindowController } from "../window/controller";
import type { WindowMode } from "../window/geometry";

/** Bind native events once; view changes and user resizing share a single window controller. */
export function useWindowBehavior(
  ready: boolean,
  mode: WindowMode,
  preferences: Preferences,
  save: (patch: Partial<Preferences>) => Promise<void>,
  onError: (message: string) => void,
) {
  const controller = useRef<WindowController | null>(null);
  const initialSize = useRef(preferences.expandedSize);
  initialSize.current = preferences.expandedSize;
  useEffect(() => {
    if (!bridge.native || !ready) return;
    const owner = new WindowController(bridge, initialSize.current, save);
    controller.current = owner;
    let disposed = false;
    const unlisten: (() => void)[] = [];
    let moveTimer: ReturnType<typeof setTimeout>,
      resizeTimer: ReturnType<typeof setTimeout>;
    const report = (e: unknown) => onError(String(e));
    // Listener registration is asynchronous; dispose late registrations during StrictMode cleanup too.
    const register = (listener: Promise<() => void>) =>
      void listener
        .then((fn) => (disposed ? fn() : unlisten.push(fn)))
        .catch(report);
    register(
      bridge.onMove((x, y) => {
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => void owner.moved(x, y).catch(report), 500);
      }),
    );
    register(
      bridge.onResize((size) => {
        const patch = owner.resized(size);
        if (patch) {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => void save(patch).catch(report), 500);
        }
      }),
    );
    return () => {
      disposed = true;
      clearTimeout(moveTimer);
      clearTimeout(resizeTimer);
      unlisten.forEach((fn) => fn());
      void owner.stop().catch(report);
      controller.current = null;
    };
  }, [ready, save, onError]);
  useEffect(() => {
    if (ready)
      void controller.current?.enter(mode).catch((e) => onError(String(e)));
  }, [ready, mode, onError]);
}
