import assert from "node:assert/strict";
import test from "node:test";
import { extractCategory } from "../lib/prompt.js";
import { checkedSummary, InvalidSummaryResponse, SummaryQualityError, summaryQualityIssues } from "../lib/summaryQuality.js";
const isValidArticleSummary = (text: string, withMore: boolean) => summaryQualityIssues(text, withMore).length === 0;

test("обрывок из поста 38110 не принимается за саммари", () => {
  const result = extractCategory("ТЕМА: film\nНо");
  assert.equal(isValidArticleSummary(result.summary, false), false);
  assert.equal(isValidArticleSummary(result.summary, true), false);
  assert.equal(isValidArticleSummary("Но.", false), false);
  assert.equal(isValidArticleSummary("ТЕМА", false), false);
});

test("проверяются продолжение, разметка и обрыв до подрезания", () => {
  const lead = "Компания представила новую версию своего приложения.";
  for (const more of ["Но", "ТЕМА", "Текст статьи заканчивается прямо на", "This is a short summary.", "The company announced a new product for customers around the entire world.", "Компанія оголосила нові зміни у своїй стратегії."]) {
    assert.equal(isValidArticleSummary(`${lead}\n===\n${more}`, true), false);
  }
  for (const text of ["===", "ТЕМА: science", `${lead} Но`, `${lead}\n===\n`, "Извините, я не могу составить пересказ этого материала."]) {
    assert.equal(isValidArticleSummary(extractCategory(text).summary, true), false);
  }
  assert.equal(isValidArticleSummary('Компания представила новую игру «Вперёд»', false), false);
  assert.equal(isValidArticleSummary('Компания представила новую игру «Вперёд».', false), true);
  assert.equal(isValidArticleSummary("Извините, но придется один день поговорить о политике.", false), true);
});

test("общий бюджет не сбрасывается при смене контекста, последняя попытка четвёртая", async () => {
  const budget = { attempts: 0, reasons: [] as string[] };
  await checkedSummary(async () => "NO_CONTENT", text => summaryQualityIssues(text, false), budget);
  const attempts: number[] = [];
  await assert.rejects(checkedSummary(async attempt => { attempts.push(attempt); return "Но"; }, text => summaryQualityIssues(text, false), budget),
    (err: unknown) => err instanceof SummaryQualityError && err.attempts === 4 && err.reasons.includes("lead:too_short"));
  assert.deepEqual(attempts, [2, 3, 4]);
  await assert.rejects(checkedSummary(async () => { assert.fail("лимит исчерпан"); }, () => [], budget), SummaryQualityError);
});

test("ошибка структуры API ограничена бюджетом, исправленный ответ принимается", async () => {
  let calls = 0;
  const text = "Компания представила новую версию своего приложения.";
  assert.equal(await checkedSummary(async () => {
    if (++calls === 1) throw new InvalidSummaryResponse("gemini_finish:MAX_TOKENS");
    return text;
  }, t => summaryQualityIssues(t, false), { attempts: 0, reasons: [] }), text);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(checkedSummary(async () => { calls++; throw new InvalidSummaryResponse("empty"); }, () => [], { attempts: 0, reasons: [] }), SummaryQualityError);
  assert.equal(calls, 4);
});

test("сетевая ошибка не объявляется дефектом качества и не запускает цикл качества", async () => {
  let calls = 0;
  const error = new Error("network unavailable");
  await assert.rejects(checkedSummary(async () => { calls++; throw error; }, () => [], { attempts: 0, reasons: [] }), err => err === error);
  assert.equal(calls, 1);
});
test("подробности не маскируют оборванное главное", () => {
  assert.equal(isValidArticleSummary("Но\n===\nМартин Макдона снял фильм о поездке двух агентов ЦРУ по Чили.", true), false);
});
test("принимаются законченный короткий пересказ и сигнал отсутствия контента", () => {
  assert.equal(isValidArticleSummary("Мартин Макдона снял фильм о поездке двух агентов ЦРУ по Чили.", false), true);
  assert.equal(isValidArticleSummary("NO_CONTENT", false), true);
  assert.equal(isValidArticleSummary("NO_CONTENT", true), true);
});
