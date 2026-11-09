import { test } from "node:test";
import assert from "node:assert/strict";
import {
  remaining,
  duration,
  canUse,
  sortedCredits,
  demoSnapshot,
  outcomeMessage,
  localizedTitle,
} from "../src/model.ts";
test("unknown and invalid quota never become zero or full", () => {
  assert.equal(remaining(), null);
  assert.equal(
    remaining({ minutes: 300, usedPercent: 101, resetsAt: null }),
    null,
  );
  assert.equal(
    remaining({ minutes: 300, usedPercent: 28, resetsAt: null }),
    72,
  );
});
test("countdown distinguishes missing, expired and future", () => {
  assert.equal(duration(null, 100), "时间未提供");
  assert.equal(duration(99, 100), "已到时间");
  assert.equal(duration(100 + 8280, 100), "2 小时 18 分");
});
test("expiry sort puts undated cards last and blocks used cards", () => {
  const sample = demoSnapshot().credits[0];
  const now = 100;
  const c = [
    { ...sample, id: "unknown", expiresAt: null },
    { ...sample, id: "late", expiresAt: 300 },
    { ...sample, id: "early", expiresAt: 150 },
  ];
  assert.deepEqual(
    sortedCredits(c).map((x) => x.id),
    ["early", "late", "unknown"],
  );
  assert.equal(
    canUse({ ...sample, status: "redeemed", expiresAt: 300 }, now),
    false,
  );
  assert.equal(canUse({ ...sample, expiresAt: 100 }, now), false);
});
test("non-success redemption outcomes never claim success", () => {
  assert.match(outcomeMessage("nothingToReset"), /没有可重置/);
  assert.match(outcomeMessage("noCredit"), /没有可用/);
  assert.match(outcomeMessage("unexpected"), /待确认/);
});
test("english credit titles localize, unknown ones pass through", () => {
  assert.equal(localizedTitle(null), null);
  assert.equal(
    localizedTitle("Full reset (Weekly + 5 hr)"),
    "完整重置（周额度 + 5 小时）",
  );
  assert.equal(localizedTitle("Mystery bonus"), "Mystery bonus");
});

import { subscriptionText } from "../src/subscription.ts";
test("subscription date handles missing and elapsed periods without claiming cancellation", () => {
  assert.equal(subscriptionText(null, 10), null);
  assert.match(
    subscriptionText(2100000000, 2100000000 - 23 * 86400)!.full,
    /订阅有效至 .*剩余 23 天/,
  );
  const end = new Date(2027, 0, 1, 0, 5).getTime() / 1000;
  assert.equal(
    subscriptionText(end, end - 3660)?.compact,
    "有效至 01/01 00:05 · 剩余 1 小时 1 分",
  );
  assert.equal(
    subscriptionText(end, end - 86400)?.compact,
    "有效至 2027/01/01 · 剩余 1 天",
  );
  assert.match(subscriptionText(end, end - 59)!.full, /剩余不足 1 分钟/);
  assert.match(subscriptionText(end, end + 1)!.compact, /订阅日期待同步/);
});
