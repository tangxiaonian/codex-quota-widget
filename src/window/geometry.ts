import type { RailEdge, WindowSize } from "../model";
export type WindowMode =
  | "compact"
  | "expanded"
  | "settings"
  | "confirmation"
  | "rail"
  | "railHover"
  | "railSliver";

export interface Display {
  position: { x: number; y: number };
  size: WindowSize;
  workArea: { position: { x: number; y: number }; size: WindowSize };
  scaleFactor: number;
}

// Include 10pt breathing room around the 56pt strip and 304pt popover so soft shadows never clip.
export const RAIL_WIDTH = 76;
export const RAIL_POPOVER_WIDTH = 304;
export const RAIL_POPOVER_WINDOW_WIDTH = RAIL_POPOVER_WIDTH + 20;
// Both windows carry 10pt transparent shadow padding; overlapping by 10pt keeps a 10pt card gap with zero dead zone.
export const RAIL_POPOVER_WINDOW_OVERLAP = 10;
export const RAIL_POPOVER_GAP = 10;
export const RAIL_HOVER_WIDTH = RAIL_WIDTH + RAIL_POPOVER_GAP + RAIL_POPOVER_WIDTH;
export const EDGE_SNAP_THRESHOLD = 28;

/** Determine whether a mode belongs to the edge-docked side rail family. */
export function isRailMode(mode: WindowMode): boolean {
  return mode === "rail" || mode === "railHover" || mode === "railSliver";
}

/** Compute the logical height of the vertical side rail (with shadow padding) for 1–3 enabled sources. */
export function railHeight(enabledCount: number): number {
  const count = Math.max(1, Math.min(3, enabledCount));
  return 82 + count * 52;
}

/** Keep logical dimensions inside the monitor's physical work area. */
export function fitSize(
  size: WindowSize,
  display?: Display | null,
): WindowSize {
  return display
    ? {
        width: Math.min(
          size.width,
          display.workArea.size.width / display.scaleFactor,
        ),
        height: Math.min(
          size.height,
          display.workArea.size.height / display.scaleFactor,
        ),
      }
    : size;
}

/** Choose the screen containing the saved origin, then constrain the complete card to its work area. */
export function restoreFrame(
  position: { x: number | null; y: number | null },
  size: WindowSize,
  displays: Display[],
  fallback: Display,
) {
  const saved = findDisplay(position, size, displays);
  const display = saved ?? fallback;
  const fitted = fitSize(size, display);
  const area = display.workArea;
  const maxX =
    area.position.x + area.size.width - fitted.width * display.scaleFactor;
  const maxY =
    area.position.y + area.size.height - fitted.height * display.scaleFactor;
  return {
    ...fitted,
    x: Math.round(
      Math.min(
        maxX,
        Math.max(
          area.position.x,
          saved ? position.x! : maxX - 24 * display.scaleFactor,
        ),
      ),
    ),
    y: Math.round(
      Math.min(
        maxY,
        Math.max(
          area.position.y,
          saved ? position.y! : area.position.y + 80 * display.scaleFactor,
        ),
      ),
    ),
  };
}

function findDisplay(
  position: { x: number | null; y: number | null },
  size: WindowSize,
  displays: Display[],
): Display | undefined {
  if (position.x == null || position.y == null) return undefined;
  const byOrigin = displays.find(
    (d) =>
      position.x! >= d.position.x &&
      position.x! < d.position.x + d.size.width &&
      position.y! >= d.position.y &&
      position.y! < d.position.y + d.size.height,
  );
  if (byOrigin) return byOrigin;
  return displays.find((d) => {
    const cx = position.x! + (size.width * d.scaleFactor) / 2;
    const cy = position.y! + (size.height * d.scaleFactor) / 2;
    return (
      cx >= d.position.x &&
      cx < d.position.x + d.size.width &&
      cy >= d.position.y &&
      cy < d.position.y + d.size.height
    );
  });
}

/**
 * Snap a freely dragged rail to the left or right display edge only when dropped within
 * `threshold` logical points; otherwise preserve the user's exact desktop position.
 */
export function snapRailPosition(
  position: { x: number; y: number },
  size: WindowSize,
  displays: Display[],
  fallback: Display,
  threshold = EDGE_SNAP_THRESHOLD,
): { x: number; y: number; snappedEdge: RailEdge | null } {
  const display = findDisplay(position, size, displays) ?? fallback;
  const area = display.workArea;
  // The rail canvas already carries 11pt internal shadow padding, so outer inset stays 0.
  const leftX = area.position.x;
  const rightX =
    area.position.x + area.size.width - size.width * display.scaleFactor;
  const minY = area.position.y;
  const maxY =
    area.position.y + area.size.height - size.height * display.scaleFactor;
  const clampedY = Math.round(Math.min(maxY, Math.max(minY, position.y)));
  const snapDist = threshold * display.scaleFactor;

  if (position.x - leftX <= snapDist) {
    return { x: Math.round(leftX), y: clampedY, snappedEdge: "left" };
  }
  if (rightX - position.x <= snapDist) {
    return { x: Math.round(rightX), y: clampedY, snappedEdge: "right" };
  }
  return {
    x: Math.round(Math.min(rightX, Math.max(leftX, position.x))),
    y: clampedY,
    snappedEdge: null,
  };
}

/**
 * Compute where the hover popover should open relative to the rail's actual anchor `(x, y)`.
 * Both X and Y are compensated (`popoverSide` + `railOffsetY`) so the rail strip stays
 * completely motionless on screen even when the popover shifts up to clear the Dock.
 */
export function railHoverFrame(
  anchor: { x: number | null; y: number | null },
  preferredEdge: RailEdge,
  railSize: WindowSize,
  hoverSize: WindowSize,
  displays: Display[],
  fallback: Display,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  popoverSide: RailEdge;
  railOffsetY: number;
} {
  const display = findDisplay(anchor, railSize, displays) ?? fallback;
  const fitted = fitSize(hoverSize, display);
  const area = display.workArea;
  const scale = display.scaleFactor;

  // Fallback anchor when no saved coordinates exist yet.
  const base =
    anchor.x != null && anchor.y != null
      ? { x: anchor.x, y: anchor.y }
      : railFrame(preferredEdge, anchor, railSize, displays, fallback, 0);

  const extraW = Math.max(0, fitted.width - railSize.width) * scale;
  const spaceLeft = base.x - area.position.x;
  const spaceRight =
    area.position.x + area.size.width - (base.x + railSize.width * scale);

  let popoverSide: RailEdge;
  if (preferredEdge === "left" && spaceRight >= extraW) {
    popoverSide = "right";
  } else if (preferredEdge === "right" && spaceLeft >= extraW) {
    popoverSide = "left";
  } else {
    popoverSide = spaceLeft >= spaceRight ? "left" : "right";
  }

  const rawX = popoverSide === "left" ? base.x - extraW : base.x;
  const minX = area.position.x;
  const maxX = area.position.x + area.size.width - fitted.width * scale;
  const minY = area.position.y;
  const maxY = area.position.y + area.size.height - fitted.height * scale;
  const clampedY = Math.round(Math.min(maxY, Math.max(minY, base.y)));
  const maxOffsetY = Math.max(0, Math.floor(fitted.height - railSize.height));
  const railOffsetY = Math.max(
    0,
    Math.min(maxOffsetY, Math.round((base.y - clampedY) / scale)),
  );

  return {
    ...fitted,
    x: Math.round(Math.min(maxX, Math.max(minX, rawX))),
    y: clampedY,
    popoverSide,
    railOffsetY,
  };
}

/**
 * Compute the screen frame of the separate rail-popover window adjacent to a stationary rail strip.
 * Keeps the rail window untouched while clamping the popover inside the monitor work area.
 */
export function railPopoverFrame(
  railAnchor: { x: number | null; y: number | null },
  preferredEdge: RailEdge,
  railSize: WindowSize,
  popoverSize: WindowSize,
  displays: Display[],
  fallback: Display,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  popoverSide: RailEdge;
} {
  const display = findDisplay(railAnchor, railSize, displays) ?? fallback;
  const fitted = fitSize(popoverSize, display);
  const area = display.workArea;
  const scale = display.scaleFactor;

  const base =
    railAnchor.x != null && railAnchor.y != null
      ? { x: railAnchor.x, y: railAnchor.y }
      : railFrame(preferredEdge, railAnchor, railSize, displays, fallback, 0);

  const stepW = (fitted.width - RAIL_POPOVER_WINDOW_OVERLAP) * scale;
  const spaceLeft = base.x - area.position.x;
  const spaceRight =
    area.position.x + area.size.width - (base.x + railSize.width * scale);

  let popoverSide: RailEdge;
  if (preferredEdge === "left" && spaceRight >= stepW) {
    popoverSide = "right";
  } else if (preferredEdge === "right" && spaceLeft >= stepW) {
    popoverSide = "left";
  } else {
    popoverSide = spaceLeft >= spaceRight ? "left" : "right";
  }

  const rawX =
    popoverSide === "left"
      ? base.x - stepW
      : base.x + (railSize.width - RAIL_POPOVER_WINDOW_OVERLAP) * scale;
  const minX = area.position.x;
  const maxX = area.position.x + area.size.width - fitted.width * scale;
  const minY = area.position.y;
  const maxY = area.position.y + area.size.height - fitted.height * scale;

  return {
    ...fitted,
    x: Math.round(Math.min(maxX, Math.max(minX, rawX))),
    y: Math.round(Math.min(maxY, Math.max(minY, base.y))),
    popoverSide,
  };
}

/**
 * Anchor a side-rail strictly to the chosen screen edge (used for first launch, sliver, or explicit edge switch).
 */
export function railFrame(
  edge: RailEdge,
  anchor: { x: number | null; y: number | null },
  size: WindowSize,
  displays: Display[],
  fallback: Display,
  insetLogical = 0,
) {
  const display = findDisplay(anchor, size, displays) ?? fallback;
  const fitted = fitSize(size, display);
  const area = display.workArea;
  const inset = insetLogical * display.scaleFactor;
  const x =
    edge === "left"
      ? area.position.x + inset
      : area.position.x +
        area.size.width -
        fitted.width * display.scaleFactor -
        inset;
  const maxY =
    area.position.y + area.size.height - fitted.height * display.scaleFactor;
  const defaultY = area.position.y + Math.round(area.size.height * 0.24);
  const y = Math.min(
    maxY,
    Math.max(area.position.y + inset, anchor.y != null ? anchor.y : defaultY),
  );
  return {
    ...fitted,
    x: Math.round(x),
    y: Math.round(y),
  };
}
