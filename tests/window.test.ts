import test from "node:test";
import assert from "node:assert/strict";
import { WindowController, type WindowPort } from "../src/window/controller.ts";
import {
  restoreFrame,
  type Display,
  type WindowMode,
} from "../src/window/geometry.ts";
import { defaults, type Preferences, type WindowSize } from "../src/model.ts";

/** Model the OS boundary while exercising the same controller used by React. */
function harness(expanded: WindowSize | null = null) {
  let parked = false;
  const applications: { mode: WindowMode; size: WindowSize }[] = [];
  let prefs: Preferences = { ...defaults };
  const port: WindowPort = {
    async disarmTopHide() {
      parked = false;
    },
    async armTopHide() {
      parked = true;
    },
    async applyWindowMode(mode, size) {
      assert.equal(
        parked,
        false,
        "parking must stop before entering another view",
      );
      applications.push({ mode, size });
    },
  };
  const owner = new WindowController(port, expanded, async (patch) => {
    prefs = { ...prefs, ...patch };
  });
  return {
    owner,
    applications,
    parked: () => parked,
    preferences: () => prefs,
  };
}

test("parked compact -> expanded/settings/confirmation restores visibility and cannot repark on move", async () => {
  for (const mode of ["expanded", "settings", "confirmation"] as const) {
    const h = harness();
    await h.owner.enter("compact");
    assert.equal(h.parked(), true);
    await h.owner.enter(mode);
    await h.owner.moved(100, -800);
    assert.equal(h.parked(), false);
    assert.equal(
      h.preferences().y,
      -800,
      "negative display positions must be saved",
    );
  }
});

test("data refresh does not resize, expanded user size survives views and restart", async () => {
  const h = harness();
  await h.owner.enter("expanded");
  const patch = h.owner.resized({ width: 530, height: 760 });
  assert.deepEqual(patch, { expandedSize: { width: 530, height: 760 } });
  await h.owner.enter("expanded");
  assert.equal(h.applications.length, 1);
  await h.owner.enter("settings");
  h.owner.resized({ width: 400, height: 500 });
  await h.owner.enter("expanded");
  assert.deepEqual(h.applications.at(-1)?.size, patch?.expandedSize);
  const restarted = harness(patch?.expandedSize);
  await restarted.owner.enter("expanded");
  assert.deepEqual(restarted.applications[0].size, patch?.expandedSize);
  await restarted.owner.enter("compact");
  assert.equal(restarted.owner.resized({ width: 900, height: 900 }), null);
  assert.deepEqual(restarted.applications.at(-1)?.size, {
    width: 360,
    height: 104,
  });
  await restarted.owner.stop();
  assert.equal(restarted.parked(), false);
});

const primary: Display = {
  position: { x: 0, y: 0 },
  size: { width: 2880, height: 1800 },
  scaleFactor: 2,
  workArea: { position: { x: 0, y: 50 }, size: { width: 2880, height: 1700 } },
};
const above: Display = {
  position: { x: -200, y: -1080 },
  size: { width: 1920, height: 1080 },
  scaleFactor: 1,
  workArea: {
    position: { x: -200, y: -1056 },
    size: { width: 1920, height: 1030 },
  },
};
test("restore keeps upper/negative secondary display coordinates with different scaling", () => {
  assert.deepEqual(
    restoreFrame(
      { x: 100, y: -900 },
      { width: 530, height: 760 },
      [primary, above],
      primary,
    ),
    { x: 100, y: -900, width: 530, height: 760 },
  );
});
test("restoration clamps the whole card, and disconnected displays fall back to the primary work area", () => {
  const edge = restoreFrame(
    { x: 1600, y: -100 },
    { width: 530, height: 760 },
    [primary, above],
    primary,
  );
  assert.deepEqual(edge, { x: 1190, y: -786, width: 530, height: 760 });
  const removed = restoreFrame(
    { x: 100, y: -900 },
    { width: 2000, height: 2000 },
    [primary],
    primary,
  );
  assert.deepEqual(removed, { x: 0, y: 50, width: 1440, height: 850 });
});

test("a first launch defaults below the automatic parking zone", () => {
  const frame = restoreFrame(
    { x: null, y: null },
    { width: 360, height: 104 },
    [primary],
    primary,
  );
  assert.ok((frame.y - primary.workArea.position.y) / primary.scaleFactor > 60);
});
