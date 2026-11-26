import type { Preferences, RailEdge, WindowSize } from "../model";
import {
  isRailMode,
  RAIL_HOVER_WIDTH,
  RAIL_WIDTH,
  type WindowMode,
} from "./geometry";

export interface RailHoverLayout {
  popoverSide: RailEdge;
  railOffsetY: number;
}

export interface WindowPort {
  disarmTopHide(): Promise<void>;
  armTopHide(): Promise<void>;
  applyWindowMode(
    mode: WindowMode,
    size: WindowSize,
    railEdge?: RailEdge,
    railAnchor?: { x: number | null; y: number | null },
    railBaseHeight?: number,
  ): Promise<RailHoverLayout | void>;
  snapRail?(
    position: { x: number; y: number },
    size: WindowSize,
  ): Promise<{ x: number; y: number; snappedEdge: RailEdge | null }>;
}

export interface EnterOptions {
  miniHeight?: number;
  railHeight?: number;
  railHoverHeight?: number;
  railEdge?: RailEdge;
  railAnchor?: { x: number | null; y: number | null };
  onRailHoverLayout?: (layout: RailHoverLayout) => void;
}

/** Own transitions independently of React renders; data refreshes never resize the window. */
export class WindowController {
  private mode: WindowMode | null = null;
  private transitioning = false;
  private railEdge: RailEdge = "right";
  private railAnchor: { x: number | null; y: number | null } = {
    x: null,
    y: null,
  };
  private sizes: Record<WindowMode, WindowSize>;

  constructor(
    private port: WindowPort,
    expanded: WindowSize | null,
    private save: (patch: Partial<Preferences>) => Promise<void>,
    initialAnchor?: { x: number | null; y: number | null },
  ) {
    if (initialAnchor) {
      this.railAnchor = { ...initialAnchor };
    }
    this.sizes = {
      compact: { width: 360, height: 104 },
      expanded: expanded ?? { width: 368, height: 524 },
      settings: { width: 368, height: 474 },
      confirmation: { width: 368, height: 435 },
      rail: { width: RAIL_WIDTH, height: 150 },
      railHover: { width: RAIL_HOVER_WIDTH, height: 244 },
      railSliver: { width: 14, height: 150 },
    };
  }

  /** Cancel parking before entering any view, including settings opened while the mini bar is invisible. */
  async enter(mode: WindowMode, miniOrOptions: number | EnterOptions = 104) {
    const opts: EnterOptions =
      typeof miniOrOptions === "number"
        ? { miniHeight: miniOrOptions }
        : miniOrOptions;
    const miniHeight = opts.miniHeight ?? 104;
    const nextRailHeight = opts.railHeight ?? this.sizes.rail.height;
    const nextHoverHeight = opts.railHoverHeight ?? Math.max(226, nextRailHeight + 48);
    const nextRailEdge = opts.railEdge ?? this.railEdge;

    if (opts.railAnchor && (opts.railAnchor.x != null || opts.railAnchor.y != null)) {
      if (this.railAnchor.x == null && this.railAnchor.y == null) {
        this.railAnchor = { ...opts.railAnchor };
      }
    }

    const edgeChanged = this.railEdge !== nextRailEdge;
    if (edgeChanged) {
      // Explicit edge switch from Settings resets horizontal anchor so rail snaps to the chosen side.
      this.railAnchor = { x: null, y: this.railAnchor.y };
    }

    const resizeMini =
      mode === "compact" && this.sizes.compact.height !== miniHeight;
    const resizeRail =
      (mode === "rail" || mode === "railSliver") &&
      (this.sizes[mode].height !== nextRailHeight || edgeChanged);
    const resizeRailHover =
      mode === "railHover" &&
      (this.sizes.railHover.height !== nextHoverHeight || edgeChanged);

    if (
      this.mode === mode &&
      !resizeMini &&
      !resizeRail &&
      !resizeRailHover
    ) {
      return;
    }

    if (resizeMini) {
      this.sizes.compact = { width: 360, height: miniHeight };
    }
    this.sizes.rail = { width: RAIL_WIDTH, height: nextRailHeight };
    this.sizes.railSliver = { width: 14, height: nextRailHeight };
    this.sizes.railHover = { width: RAIL_HOVER_WIDTH, height: nextHoverHeight };
    this.railEdge = nextRailEdge;

    this.transitioning = true;
    this.mode = mode;
    try {
      await this.port.disarmTopHide();
      const layout = await this.port.applyWindowMode(
        mode,
        this.sizes[mode],
        isRailMode(mode) ? this.railEdge : undefined,
        isRailMode(mode) ? this.railAnchor : undefined,
        isRailMode(mode) ? this.sizes.rail.height : undefined,
      );
      if (layout && opts.onRailHoverLayout) {
        opts.onRailHoverLayout(layout);
      } else if (mode !== "railHover" && opts.onRailHoverLayout) {
        opts.onRailHoverLayout({
          popoverSide: this.railEdge === "left" ? "right" : "left",
          railOffsetY: 0,
        });
      }
    } finally {
      this.transitioning = false;
    }
    if (mode === "compact") await this.port.armTopHide();
  }

  /** Track live drag coordinates immediately so a quick post-drag hover never snaps back to an old anchor. */
  trackMove(x: number, y: number) {
    if (this.transitioning || this.mode !== "rail") return;
    this.railAnchor = { x, y };
  }

  /** Persist drags; in rail mode snap only near display edges and keep free positions elsewhere. */
  async moved(x: number, y: number) {
    if (this.transitioning || this.mode === "railHover" || this.mode === "railSliver") {
      return;
    }
    if (this.mode === "rail") {
      if (this.port.snapRail) {
        this.transitioning = true;
        try {
          const snapped = await this.port.snapRail({ x, y }, this.sizes.rail);
          this.railAnchor = { x: snapped.x, y: snapped.y };
          const patch: Partial<Preferences> = { x: snapped.x, y: snapped.y };
          if (snapped.snappedEdge) {
            this.railEdge = snapped.snappedEdge;
            patch.railEdge = snapped.snappedEdge;
          }
          await this.save(patch);
        } finally {
          this.transitioning = false;
        }
        return;
      }
      this.railAnchor = { x, y };
      await this.save({ x, y });
      return;
    }
    await this.save({ x, y });
    if (this.mode === "compact") await this.port.armTopHide();
  }

  /** Remember each view in-session; persist the user's expanded card dimensions across restarts. */
  resized(size: WindowSize): Partial<Preferences> | null {
    if (
      !this.mode ||
      this.mode === "compact" ||
      isRailMode(this.mode) ||
      this.transitioning
    )
      return null;
    this.sizes[this.mode] = size;
    return this.mode === "expanded" ? { expandedSize: size } : null;
  }

  /** Disable the native watcher when a lifecycle hides the card or the React owner unmounts. */
  async stop() {
    await this.port.disarmTopHide();
  }
}
