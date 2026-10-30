import assert from "node:assert/strict";
import test from "node:test";
import { geminiOverload } from "./geminiOverload.js";

const HOUR = 60 * 60 * 1000;
const busyHour = 500_000;
const failures = Array.from({ length: 5 }, (_, i) => busyHour * HOUR + i * 1000);

test("does not report postponed articles from hours without overload", () => {
  const report = geminiOverload(failures, [{ at: (busyHour + 3) * HOUR, article: "https://example.com/quiet" }]);

  assert.ok(report?.includes("статьи не потеряны"));
  assert.ok(!report?.includes("статья отложена"));
});

test("counts each unique postponed article once during overload hours", () => {
  const url = "https://example.com/story";
  const report = geminiOverload(failures, [
    { at: busyHour * HOUR + 1000, article: url },
    { at: busyHour * HOUR + 2000, article: url },
    { at: busyHour * HOUR + 3000, article: "https://example.com/another" },
    { at: (busyHour + 3) * HOUR, article: "https://example.com/quiet" },
  ]);

  assert.ok(report?.includes("2 статьи отложены"));
});

test("does not report overload below the hourly failure threshold", () => {
  const report = geminiOverload(failures.slice(0, 4), [
    { at: busyHour * HOUR, article: "https://example.com/story" },
  ]);

  assert.equal(report, null);
});
