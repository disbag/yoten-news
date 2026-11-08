import assert from "node:assert/strict";
import test from "node:test";
import { parseThreadAnswer, threadQualityIssues } from "../lib/threadQuality.js";
import { checkedSummary, SummaryQualityError } from "../lib/summaryQuality.js";

test("тред принимает отсутствие новых фактов и отклоняет некорректный формат", () => {
  assert.deepEqual(parseThreadAnswer("ТРЕД: 0\nНОВОЕ: нет", 2), { thread: 0, details: null });
  assert.deepEqual(threadQualityIssues("ТРЕД: 1\nНОВОЕ: нет.", 2), []);
  for (const raw of ["ТРЕД: 1", "ТРЕД: 3\nНОВОЕ: нет", "ТРЕД: 0\nНОВОЕ: Об", "ТРЕД: 1\nНОВОЕ: NO_CONTENT"]) {
    assert.ok(threadQualityIssues(raw, 2).length);
  }
});

test("продолжение треда проверяется отдельно от служебных строк", () => {
  for (const text of ["Об", "Индустриальная секция Just Film Industry Days пройдет с 18 по", "The company released a new version of its application."]) {
    assert.ok(threadQualityIssues(`ТРЕД: 1\nНОВОЕ: ${text}`, 1).length);
  }
  assert.deepEqual(threadQualityIssues("ТРЕД: 1\nНОВОЕ: Индустриальная секция пройдёт с 18 по 20 ноября.", 1), []);
});

test("повреждённое продолжение исчерпывает бюджет за четыре попытки", async () => {
  let calls = 0;
  await assert.rejects(checkedSummary(async () => { calls++; return "ТРЕД: 1\nНОВОЕ: Об"; }, raw => threadQualityIssues(raw, 1), { attempts: 0, reasons: [] }), SummaryQualityError);
  assert.equal(calls, 4);
});
