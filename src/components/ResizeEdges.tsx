import * as bridge from "../bridge";
/** Expose native edge resizing only for the expanded and auxiliary views. */
export function ResizeEdges({
  onError,
}: {
  onError: (message: string) => void;
}) {
  if (!bridge.native) return null;
  return (
    <div className="resize-edges" aria-hidden="true">
      {(
        [
          "North",
          "South",
          "East",
          "West",
          "NorthEast",
          "NorthWest",
          "SouthEast",
          "SouthWest",
        ] as const
      ).map((direction) => (
        <div
          key={direction}
          className={`resize-edge ${direction}`}
          title="拖动调整大小"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            void bridge
              .resizeDrag(direction)
              .catch((error) => onError(String(error)));
          }}
        />
      ))}
    </div>
  );
}
