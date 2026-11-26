import test from "node:test";
import assert from "node:assert/strict";
import { defaults, demoSnapshot } from "../src/model.ts";
import { formatTrayTitle } from "../src/trayTitle.ts";
import { appendSample, estimateDepletion } from "../src/burnRate.ts";
import {
  RAIL_HOVER_WIDTH,
  RAIL_WIDTH,
  railFrame,
  railHoverFrame,
  snapRailPosition,
  type Display,
} from "../src/window/geometry.ts";
import { primaryQuota } from "../src/antigravity.ts";
import { WindowController, type WindowPort } from "../src/window/controller.ts";
import { cacheHitRate, formatCost, formatTokens } from "../src/usageTypes.ts";

test("tray title formats tightest and all modes with low-quota alerts without fabricating missing sources", () => {
  const codex = demoSnapshot(); // 5h remaining 72%, weekly remaining 38%
  const wb = {
    accountKey: "wb-1",
    name: "demo",
    plan: "Pro",
    remaining: 90,
    total: 1000, // 9% -> critical
    used: 910,
    groups: [],
    packages: [],
    packageError: null,
    fetchedAt: 100,
  };
  assert.equal(
    formatTrayTitle({ ...defaults, trayTitleMode: "none" }, codex, wb, null),
    "",
  );
  assert.equal(
    formatTrayTitle({ ...defaults, trayTitleMode: "tightest" }, codex, wb, null),
    "!W 9%",
  );
  assert.equal(
    formatTrayTitle({ ...defaults, trayTitleMode: "all" }, codex, wb, null),
    "C38% !W9%",
  );
  assert.equal(
    formatTrayTitle(
      { ...defaults, trayTitleMode: "tightest", workbuddyEnabled: false },
      codex,
      wb,
      null,
    ),
    "C 38%",
  );
  assert.equal(
    formatTrayTitle({ ...defaults, trayTitleMode: "all" }, null, null, null),
    "",
  );
});

test("burn rate projects depletion only before reset and clears history after refill", () => {
  let samples = appendSample([], 80, 1000);
  samples = appendSample(samples, 60, 1600); // dropped 20% in 600s -> 0% at 3400s
  assert.equal(estimateDepletion(samples, 5000, 1600), 3400);
  // Reset arrives earlier than projected depletion -> stay silent.
  assert.equal(estimateDepletion(samples, 3000, 1600), null);
  // Quota refilled -> old points cleared, cannot predict from 1 sample.
  samples = appendSample(samples, 100, 2000);
  assert.equal(samples.length, 1);
  assert.equal(estimateDepletion(samples, 8000, 2000), null);
});

test("rail drags freely anywhere on desktop and only snaps near screen edges", () => {
  const display: Display = {
    position: { x: 0, y: 0 },
    size: { width: 2880, height: 1800 },
    scaleFactor: 2,
    workArea: { position: { x: 0, y: 50 }, size: { width: 2880, height: 1700 } },
  };
  const size = { width: RAIL_WIDTH, height: 150 };
  // Dropped in the middle of the screen -> stays where dropped, no edge snap.
  const mid = snapRailPosition({ x: 1200, y: 400 }, size, [display], display);
  assert.equal(mid.x, 1200);
  assert.equal(mid.snappedEdge, null);

  // Dropped within 28pt of left edge -> snaps cleanly to left edge.
  const nearLeft = snapRailPosition({ x: 30, y: 400 }, size, [display], display);
  assert.equal(nearLeft.x, 8);
  assert.equal(nearLeft.snappedEdge, "left");

  // Hovering from a mid-screen position keeps the rail stationary while expanding the popover.
  const hover = railHoverFrame(
    { x: mid.x, y: mid.y },
    "right",
    size,
    { width: RAIL_HOVER_WIDTH, height: 260 },
    [display],
    display,
  );
  assert.equal(hover.popoverSide, "left");
  assert.equal(
    hover.x + hover.width * display.scaleFactor,
    mid.x + size.width * display.scaleFactor,
  );

  // Hovering near the bottom edge shifts the window upward to clear the Dock while
  // compensating `railOffsetY` so the rail strip itself never jumps vertically.
  const lowAnchorY = 1280; // near bottom of 1750px physical workArea
  const bottomHover = railHoverFrame(
    { x: 2760, y: lowAnchorY },
    "right",
    size,
    { width: RAIL_HOVER_WIDTH, height: 390 },
    [display],
    display,
  );
  assert.ok(bottomHover.y < lowAnchorY);
  assert.equal(
    bottomHover.y + bottomHover.railOffsetY * display.scaleFactor,
    lowAnchorY,
  );

  // Primary Antigravity ring prefers 5h session over weekly.
  const primary = primaryQuota([
    {
      name: "Gemini Models",
      windows: [
        { id: "g-5h", kind: "session", name: "5h", remaining: 94, resetsAt: null },
        { id: "g-wk", kind: "weekly", name: "weekly", remaining: 40, resetsAt: null },
      ],
    },
    {
      name: "Claude and GPT models",
      windows: [
        { id: "c-5h", kind: "session", name: "5h", remaining: 20, resetsAt: null },
      ],
    },
  ]);
  assert.equal(primary?.remaining, 94);
});

test("rail modes disarm top-hide and never overwrite persisted expandedSize", async () => {
  let parked = false;
  const calls: string[] = [];
  const port: WindowPort = {
    async disarmTopHide() {
      parked = false;
    },
    async armTopHide() {
      parked = true;
    },
    async applyWindowMode(mode, _size, edge) {
      calls.push(`${mode}:${edge ?? "-"}`);
    },
  };
  const owner = new WindowController(port, { width: 420, height: 600 }, async () => {});
  await owner.enter("compact");
  assert.equal(parked, true);
  await owner.enter("rail", { railHeight: 140, railEdge: "right" });
  assert.equal(parked, false);
  assert.equal(owner.resized({ width: 54, height: 140 }), null);
  await owner.enter("railHover", { railHeight: 140, railEdge: "right" });
  assert.deepEqual(calls, ["compact:-", "rail:right", "railHover:right"]);
});

test("usage formatting preserves unpriced status and zero-denominator cache rates", () => {
  assert.equal(formatTokens(950), "950");
  assert.equal(formatTokens(125_000), "12.5 万");
  assert.equal(formatCost(null, "CNY", 7.2), "未定价");
  assert.equal(formatCost(2, "CNY", 7.2), "¥14.40");
  assert.equal(formatCost(2, "USD", 7.2), "$2.00");
  assert.equal(cacheHitRate(0, 0), null);
  assert.equal(cacheHitRate(250, 750), 75);
});
