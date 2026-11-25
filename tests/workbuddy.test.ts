import test from "node:test";
import assert from "node:assert/strict";
import { creditPercent, points } from "../src/workbuddy.ts";
test("credits retain fractions and unknown data never becomes a balance or percentage", () => {
  assert.equal(points(null), "—");
  assert.equal(points(4545.86000144), "4,545.86");
  assert.equal(creditPercent(null, 100), null);
  assert.equal(creditPercent(1, 0), null);
  assert.equal(creditPercent(101, 100), null);
  assert.equal(creditPercent(25, 100), 25);
});

import { defaults, sourceRunning } from "../src/model.ts";
test("WorkBuddy keeps the companion visible when Codex closes, only for enabled sources", () => {
  const life = {
    running: false,
    workbuddyRunning: true,
    sleeping: false,
    reduceTransparency: false,
  };
  assert.equal(sourceRunning(life, defaults), true);
  assert.equal(
    sourceRunning(life, { ...defaults, workbuddyEnabled: false }),
    false,
  );
  assert.equal(
    sourceRunning(
      { ...life, running: true, workbuddyRunning: false },
      defaults,
    ),
    true,
  );
});

import { sortedPackages } from "../src/workbuddy.ts";
test("packages sort by nearest expiry with undated entries last without modifying the snapshot", () => {
  const base = { name: "积分包", total: 100, remaining: 20 };
  const rows = [
    { ...base, id: "unknown", expiresAt: null },
    { ...base, id: "later", expiresAt: 2000 },
    { ...base, id: "soon", expiresAt: 1000 },
  ];
  assert.deepEqual(
    sortedPackages(rows).map((p) => p.id),
    ["soon", "later", "unknown"],
  );
  assert.deepEqual(
    rows.map((p) => p.id),
    ["unknown", "later", "soon"],
  );
});
