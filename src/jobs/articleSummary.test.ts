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

test("заголовок в ответе саммаризации отделяется от текста и темы", async () => {
  const { parseArticleResponse } = await import("../lib/summarizer.js");
  const lead = "Компания представила новую версию своего приложения.";
  const more = "В приложении появилась поддержка нескольких языков.";
  const body = `ТЕМА: technology\n${lead}\n===\n${more}`;
  const original = "Company launches its new app (EXCLUSIVE)";
  const result = parseArticleResponse(`ЗАГОЛОВОК: компания обновила приложение (ЭКСКЛЮЗИВ)\n${body}`, original);
  assert.deepEqual(result, { titleRu: "Компания обновила приложение", summary: `${lead}\n===\n${more}`, category: ["technology"] });
  assert.deepEqual(parseArticleResponse(`ЗАГОЛОВОК: Company launches its new application worldwide\n${body}`, original), { ...result, titleRu: null });
  assert.deepEqual(parseArticleResponse(body, original), { ...result, titleRu: null });
  assert.equal(parseArticleResponse("NO_CONTENT", original).titleRu, null);
  assert.ok(summaryQualityIssues(`${lead}\nЗАГОЛОВОК: Компания обновила приложение.`, false).includes("lead:markup"));
});

test("запрос новой карточки получает заголовок и пересказ за один вызов модели", async t => {
  const { summarizeArticle } = await import("../lib/summarizer.js");
  const { default: fs } = await import("node:fs");
  t.mock.method(fs, "writeFileSync", () => {});
  const previousKey = process.env.GEMINI_API_KEYS;
  process.env.GEMINI_API_KEYS = "fake-key-for-test";
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({
    candidates: [{ finishReason: "STOP", content: { parts: [{
      text: "ЗАГОЛОВОК: Компания обновила приложение\nТЕМА: technology\nКомпания представила новую версию своего приложения.",
    }] } }],
  }));
  try {
    assert.deepEqual(await summarizeArticle("Company updates the app", { rawSummary: "The company released an update today." }, true), {
      titleRu: "Компания обновила приложение",
      summary: "Компания представила новую версию своего приложения.",
      more: null,
      category: ["technology"],
    });
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEYS;
    else process.env.GEMINI_API_KEYS = previousKey;
  }
});
