import codexArtwork from "../assets/source-codex.png";
import workbuddyArtwork from "../assets/source-workbuddy.svg";
import antigravityArtwork from "../assets/source-antigravity.png";
import type { SourceId } from "../model";

const SOURCE_ARTWORKS: Record<SourceId, string> = {
  codex: codexArtwork,
  workbuddy: workbuddyArtwork,
  antigravity: antigravityArtwork,
};

/** Render the visual brand emblem artwork for Codex, WorkBuddy, or Antigravity. */
export function SourceBadge({
  source,
  className,
}: {
  source: SourceId;
  className?: string;
}) {
  return (
    <img
      src={SOURCE_ARTWORKS[source]}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className}
    />
  );
}
