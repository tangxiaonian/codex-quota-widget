import { useEffect, useRef } from "react";
import * as bridge from "../bridge";
import {
  compactHeight,
  sourceOptions,
  type Preferences,
} from "../model";
import { WindowController, type RailHoverLayout } from "../window/controller";
import { railHeight, type WindowMode } from "../window/geometry";

/** Bind native events once; view changes and user resizing share a single window controller. */
export function useWindowBehavior(
  ready: boolean,
  mode: WindowMode,
  preferences: Preferences,
  save: (patch: Partial<Preferences>) => Promise<void>,
  onError: (message: string) => void,
  onRailHoverLayout?: (layout: RailHoverLayout) => void,
  railHoverHeight?: number,
  onUserMove?: () => void,
) {
  const controller = useRef<WindowController | null>(null);
  const initialSize = useRef(preferences.expandedSize);
  const initialPos = useRef({ x: preferences.x, y: preferences.y });
  const moveNotifyRef = useRef(onUserMove);
  initialSize.current = preferences.expandedSize;
  initialPos.current = { x: preferences.x, y: preferences.y };
  moveNotifyRef.current = onUserMove;

  useEffect(() => {
    if (!bridge.native || !ready) return;
    const owner = new WindowController(
      bridge,
      initialSize.current,
      save,
      initialPos.current,
    );
    controller.current = owner;
    let disposed = false;
    const unlisten: (() => void)[] = [];
    let moveTimer: ReturnType<typeof setTimeout>,
      resizeTimer: ReturnType<typeof setTimeout>;
    const report = (e: unknown) => onError(String(e));
    const register = (listener: Promise<() => void>) =>
      void listener
        .then((fn) => (disposed ? fn() : unlisten.push(fn)))
        .catch(report);
    register(
      bridge.onMove((x, y) => {
        owner.trackMove(x, y);
        moveNotifyRef.current?.();
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => void owner.moved(x, y).catch(report), 180);
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

  const miniHeight = compactHeight(preferences);
  const enabledCount = sourceOptions.filter((s) => preferences[s.enabled]).length;
  const nextRailHeight = railHeight(enabledCount);

  useEffect(() => {
    if (ready)
      void controller.current
        ?.enter(mode, {
          miniHeight,
          railHeight: nextRailHeight,
          railHoverHeight: railHoverHeight ?? Math.max(256, nextRailHeight + 60),
          railEdge: preferences.railEdge,
          railAnchor: { x: preferences.x, y: preferences.y },
          onRailHoverLayout,
        })
        .catch((e) => onError(String(e)));
  }, [
    ready,
    mode,
    miniHeight,
    nextRailHeight,
    railHoverHeight,
    preferences.railEdge,
    onRailHoverLayout,
    onError,
  ]);
}
