import type { WindowSize } from "../model";
export type WindowMode = "compact" | "expanded" | "settings" | "confirmation";
export interface Display {
  position: { x: number; y: number };
  size: WindowSize;
  workArea: { position: { x: number; y: number }; size: WindowSize };
  scaleFactor: number;
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
  const saved = displays.find(
    (d) =>
      position.x != null &&
      position.y != null &&
      position.x >= d.position.x &&
      position.x < d.position.x + d.size.width &&
      position.y >= d.position.y &&
      position.y < d.position.y + d.size.height,
  );
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
