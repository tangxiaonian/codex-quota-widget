import test from "node:test";
import assert from "node:assert/strict";
import { defaults, demoSnapshot, soonestUsableCredit } from "../src/model.ts";
import { formatTrayTitle } from "../src/trayTitle.ts";
import { appendSample, estimateDepletion } from "../src/burnRate.ts";
import {
  RAIL_HOVER_WIDTH,
  RAIL_POPOVER_WINDOW_OVERLAP,
  RAIL_POPOVER_WINDOW_WIDTH,
  RAIL_WIDTH,
  railFrame,
  railHoverFrame,
  railPopoverFrame,
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
  assert.equal(nearLeft.x, 0);
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

  // Separate native popover window opens adjacent with 10pt shadow overlap and clamps vertically on its own.
  const rightRailX = 2880 - RAIL_WIDTH * display.scaleFactor;
  const popLeft = railPopoverFrame(
    { x: rightRailX, y: lowAnchorY },
    "right",
    size,
    { width: RAIL_POPOVER_WINDOW_WIDTH, height: 390 },
    [display],
    display,
  );
  assert.equal(popLeft.popoverSide, "left");
  assert.equal(
    popLeft.x,
    rightRailX - (RAIL_POPOVER_WINDOW_WIDTH - RAIL_POPOVER_WINDOW_OVERLAP) * display.scaleFactor,
  );
  assert.ok(popLeft.y < lowAnchorY);
  assert.equal(popLeft.y + popLeft.height * display.scaleFactor, 1750);

  const popRight = railPopoverFrame(
    { x: 0, y: 400 },
    "left",
    size,
    { width: RAIL_POPOVER_WINDOW_WIDTH, height: 296 },
    [display],
    display,
  );
  assert.equal(popRight.popoverSide, "right");
  assert.equal(
    popRight.x,
    (RAIL_WIDTH - RAIL_POPOVER_WINDOW_OVERLAP) * display.scaleFactor,
  );
  assert.equal(popRight.y, 400);

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

test("soonestUsableCredit selects earliest unexpired available card and leaves undated last", () => {
  const now = 10_000;
  const picked = soonestUsableCredit(
    [
      {
        id: "expired",
        status: "available",
        title: "Expired",
        description: null,
        resetType: null,
        expiresAt: now - 60,
        grantedAt: null,
      },
      {
        id: "used",
        status: "redeemed",
        title: "Used",
        description: null,
        resetType: null,
        expiresAt: now + 60,
        grantedAt: null,
      },
      {
        id: "undated",
        status: "available",
        title: "Undated",
        description: null,
        resetType: null,
        expiresAt: null,
        grantedAt: null,
      },
      {
        id: "later",
        status: "available",
        title: "Later",
        description: null,
        resetType: null,
        expiresAt: now + 7200,
        grantedAt: null,
      },
      {
        id: "soonest",
        status: "available",
        title: "Full reset (Weekly + 5 hr)",
        description: null,
        resetType: null,
        expiresAt: now + 1800,
        grantedAt: null,
      },
    ],
    now,
  );
  assert.equal(picked?.id, "soonest");
  assert.equal(soonestUsableCredit([], now), null);
});
