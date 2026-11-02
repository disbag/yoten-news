import assert from "node:assert/strict";
import test from "node:test";
import { claimRecoverySlot, fetchWindowHours, freshFirst, inFetchWindow, normalizeFeedDate } from "./fetchPolicy.js";

const now = Date.parse("2026-11-02T11:45:00Z");
test("дата Fast Company без зоны исправляется по исходной строке", () => {
  assert.equal(normalizeFeedDate("2026-11-02T11:00:00", "2026-11-02T08:00:00Z", "+00:00"), "2026-11-02T11:00:00.000Z");
  assert.equal(normalizeFeedDate("2026-11-02T11:00:00+02:00", "2026-11-02T09:00:00Z", "+00:00"), "2026-11-02T09:00:00.000Z");
  assert.equal(normalizeFeedDate(undefined, "не дата", "+00:00"), undefined);
});
test("окно восстановления включается после сбоя, паузы или устаревшего фида", () => {
  const previous = { at: "2026-11-02T11:30:00Z", newestItemAt: "2026-11-02T11:00:00Z", retryNeeded: false, feedError: null };
  assert.equal(fetchWindowHours(undefined, now, 0), 24);
  assert.equal(fetchWindowHours(previous, now, 0), 24);
  assert.equal(fetchWindowHours({ ...previous, retryNeeded: true }, now, 0), 72);
  assert.equal(fetchWindowHours({ ...previous, feedError: "HTTP 503" }, now, 0), 72);
  assert.equal(fetchWindowHours({ ...previous, at: "2026-11-02T09:00:00Z" }, now, 0), 72);
  assert.equal(fetchWindowHours({ ...previous, newestItemAt: "2026-10-30T11:00:00Z" }, now, 0), 72);
  assert.equal(fetchWindowHours(previous, now, 4), 120);
});
test("за пределами 72 часов автоматическая догрузка не допускается", () => {
  assert.equal(inFetchWindow("2026-10-30T11:45:00Z", now, 72), true);
  assert.equal(inFetchWindow("2026-10-30T11:44:59Z", now, 72), false);
  assert.equal(inFetchWindow("2026-11-04T11:45:00Z", now, 72), false);
});
test("свежие новости идут раньше отложенных независимо от порядка RSS", () => {
  const old = { isoDate: "2026-10-31T10:00:00Z" }, fresh = { isoDate: "2026-11-02T11:00:00Z" };
  const original = [old, fresh];
  assert.deepEqual(freshFirst(original, now), [fresh, old]);
  assert.deepEqual(original, [old, fresh]);
});
test("бюджет догрузки ограничен на источник и на весь прогон", () => {
  const run = { count: 50 };
  for (let i = 0; i < 5; i++) {
    const source = { count: 10 };
    for (let j = 0; j < 10; j++) assert.equal(claimRecoverySlot(source, run), true);
    assert.equal(claimRecoverySlot(source, run), false);
  }
  assert.equal(claimRecoverySlot({ count: 10 }, run), false);
  assert.equal(run.count, 0);
});
