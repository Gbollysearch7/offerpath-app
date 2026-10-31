import assert from "node:assert/strict";
import { test } from "node:test";
import { findPeriod, listPeriods } from "@/lib/periods";

test("academic year starts in September", () => {
  const oct = listPeriods(new Date("2026-10-27T12:00:00Z"));
  assert.equal(oct[0].key, "autumn-2026");
  assert.deepEqual([oct[0].from, oct[0].to], ["2026-09-01", "2027-01-01"]);
  assert.equal(oct[3].label, "Academic year 2026–27");
  const march = listPeriods(new Date("2027-03-10T12:00:00Z"));
  assert.equal(march[3].key, "year-2026", "March belongs to the year that started the previous September");
});

test("unknown period falls back to the current term", () => {
  assert.equal(findPeriod("nonsense", new Date("2026-10-27")).key, "autumn-2026");
  assert.equal(findPeriod("all").from, null);
});
