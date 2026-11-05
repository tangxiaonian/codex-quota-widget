import type { Preferences, WindowSize } from "../model";
import type { WindowMode } from "./geometry";
export interface WindowPort {
  disarmTopHide(): Promise<void>;
  armTopHide(): Promise<void>;
  applyWindowMode(mode: WindowMode, size: WindowSize): Promise<void>;
}
/** Own transitions independently of React renders; data refreshes never resize the window. */
export class WindowController {
  private mode: WindowMode | null = null;
  private transitioning = false;
  private sizes: Record<WindowMode, WindowSize>;
  constructor(
    private port: WindowPort,
    expanded: WindowSize | null,
    private save: (patch: Partial<Preferences>) => Promise<void>,
  ) {
    this.sizes = {
      compact: { width: 360, height: 104 },
      expanded: expanded ?? { width: 368, height: 524 },
      settings: { width: 368, height: 474 },
      confirmation: { width: 368, height: 435 },
    };
  }
  /** Cancel parking before entering any view, including settings opened while the mini bar is invisible. */
  async enter(mode: WindowMode) {
    if (this.mode === mode) return;
    this.transitioning = true;
    this.mode = mode;
    try {
      await this.port.disarmTopHide();
      await this.port.applyWindowMode(mode, this.sizes[mode]);
    } finally {
      this.transitioning = false;
    }
    if (mode === "compact") await this.port.armTopHide();
  }
  /** A settled user drag may park only the compact view; native code decides screen-relative proximity. */
  async moved(x: number, y: number) {
    await this.save({ x, y });
    if (this.mode === "compact" && !this.transitioning)
      await this.port.armTopHide();
  }
  /** Remember each view in-session; persist the user's expanded card dimensions across restarts. */
  resized(size: WindowSize): Partial<Preferences> | null {
    if (!this.mode || this.mode === "compact" || this.transitioning)
      return null;
    this.sizes[this.mode] = size;
    return this.mode === "expanded" ? { expandedSize: size } : null;
  }
  /** Disable the native watcher when a lifecycle hides the card or the React owner unmounts. */
  async stop() {
    await this.port.disarmTopHide();
  }
}
