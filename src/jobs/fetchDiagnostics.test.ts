import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../lib/db.js";
import { processSource, fetchFeedText } from "./fetchAndProcess.js";
import { diagnosticFor } from "./sourceDiagnostics.js";

const now = Date.parse("2026-11-02T11:45:00Z");
const source = { id: 1, name: "Fast Company", rss_url: "https://www.fastcompany.com/co-design/rss" };
const xml = (items: string) => `<rss version="2.0"><channel><title>Test</title><description>Test</description><link>https://example.com</link>${items}</channel></rss>`;
const item = (date: string, title = "Редакционная статья") => `<item><title>${title}</title><link>https://example.com/story?partner=rss</link><pubDate>${date}</pubDate></item>`;
const response = (text: string) => Promise.resolve({ xml: text, status: 200, contentType: "application/rss+xml", age: "0" });

test("реальный rss-parser и фильтр сборщика исправляют дату и узнают ссылку без меток", async t => {
  t.mock.method(Date, "now", () => now);
  t.mock.method(pool, "query", async (_sql: string, values: unknown[]) => {
    assert.deepEqual(values[0], ["https://example.com/story"]);
    return { rows: [{ link: "https://example.com/story" }] };
  });
  const d = diagnosticFor(source);
  await processSource(source, response(xml(item("2026-11-02T11:00:00"))), { count: 100 }, d, undefined, { count: 50 }, () => {});
  assert.equal(d.newestItemAt, "2026-11-02T11:00:00.000Z");
  assert.equal(d.known, 1);
  assert.equal(d.attempted, 0);
  assert.equal(d.freshItems, 1);
});
test("запоздавшая статья среди здорового RSS попадает в догрузку с отдельным бюджетом", async t => {
  t.mock.method(Date, "now", () => now);
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const previous = { at: "2026-11-02T11:30:00Z", newestItemAt: "2026-11-02T11:00:00Z", retryNeeded: false, feedError: null };
  const d = diagnosticFor(source);
  await processSource(source, response(xml(item("2026-10-31T11:00:00Z"))), { count: 100 }, d, previous, { count: 0 }, () => {});
  assert.equal(d.eligible, 1);
  assert.equal(d.deferred, 1);
  assert.equal(d.retryNeeded, true);
  assert.equal(d.attempted, 0);
});
test("рассылка и повреждённая дата получают разные причины исключения", async t => {
  t.mock.method(Date, "now", () => now);
  const s = { ...source, name: "Hyperallergic" };
  const d = diagnosticFor(s);
  const content = item("2026-11-02T11:00:00Z").replace("</item>", "<category>Newsletter</category></item>") + item("broken date");
  await processSource(s, response(xml(content)), { count: 100 }, d, undefined, { count: 50 }, () => {});
  assert.equal(d.outcomes.excluded_category, 1);
  assert.equal(d.outcomes.invalid_date, 1);
  assert.equal(d.eligible, 0);
});
test("HTML вместо RSS фиксируется как ошибка фида, а не тихое отсутствие статей", async () => {
  const d = diagnosticFor(source);
  await processSource(source, response("<html><body>Access denied</body></html>"), { count: 100 }, d, undefined, { count: 50 }, () => {});
  assert.ok(d.feedError);
  assert.equal(d.status, 200);
  assert.ok(d.fingerprint);
  assert.equal(d.retryNeeded, true);
});
test("известная статья в окне догрузки не расходует восстановительный бюджет", async t => {
  t.mock.method(Date, "now", () => now);
  t.mock.method(pool, "query", async () => ({ rows: [{ link: "https://example.com/story" }] }));
  const d = diagnosticFor(source);
  const previous = { at: "2026-11-02T11:30:00Z", newestItemAt: "2026-11-02T11:00:00Z", retryNeeded: false, feedError: null };
  await processSource(source, response(xml(item("2026-10-31T11:00:00Z"))), { count: 100 }, d, previous, { count: 0 }, () => {});
  assert.equal(d.known, 1);
  assert.equal(d.deferred, 0);
  assert.equal(d.attempted, 0);
});
test("запоздавшая статья старше 72 часов не запускает обработку", async t => {
  t.mock.method(Date, "now", () => now);
  const query = t.mock.method(pool, "query", async () => { throw new Error("Запроса к БД быть не должно"); });
  const d = diagnosticFor(source);
  const previous = { at: "2026-11-02T11:30:00Z", newestItemAt: "2026-11-02T11:00:00Z", retryNeeded: false, feedError: null };
  await processSource(source, response(xml(item("2026-10-30T10:00:00Z"))), { count: 100 }, d, previous, { count: 50 }, () => {});
  assert.equal(d.outcomes.outside_window, 1);
  assert.equal(d.attempted, 0);
  assert.equal(query.mock.callCount(), 0);
});
test("постоянный HTTP 402 не расходует три повторных запроса", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return new Response("Access denied", { status: 402 }); });
  await assert.rejects(fetchFeedText(source.rss_url), /Status code 402/);
  assert.equal(requests, 1);
});
