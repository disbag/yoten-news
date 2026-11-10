import assert from "node:assert/strict";
import test from "node:test";
import { coverageState, type CoverageRow } from "./fetchCoverage.js";
import { prepareSource } from "./fetchAndProcess.js";
import { diagnosticFor } from "./sourceDiagnostics.js";

const now = Date.parse("2026-11-10T12:00:00Z");
const row: CoverageRow = {
  name: "Test", link: "https://example.com/article", title: "Article", decision: "eligible",
  first_seen_at: new Date(now - 3 * 3_600_000), published_at: new Date(now - 4 * 3_600_000),
  completed_checks: 2, article_id: null, published: false, skipped_reason: null,
};

test("публикация в кластере важнее старой ошибки обработки", () => {
  assert.equal(coverageState({ ...row, article_id: 1, published: true, decision: "summary_error" }, now), "published");
});
test("известная исключённая ссылка не считается опубликованной или потерянной", () => {
  assert.equal(coverageState({ ...row, skipped_reason: "sport" }, now), "excluded");
  assert.equal(coverageState({ ...row, skipped_reason: "summary_quality" }, now), "quality_failed");
  assert.equal(coverageState({ ...row, skipped_reason: "no_text" }, now), "no_text");
});
test("пропуск требует и двух часов ожидания, и двух завершённых проверок", () => {
  assert.equal(coverageState(row, now), "missing");
  assert.equal(coverageState({ ...row, completed_checks: 1 }, now), "pending");
  assert.equal(coverageState({ ...row, first_seen_at: new Date(now - 3_600_000) }, now), "pending");
});
test("строка статьи без публикации выявляется отдельно", () => {
  assert.equal(coverageState({ ...row, article_id: 1 }, now), "stuck");
  assert.equal(coverageState({ ...row, article_id: 1, completed_checks: 0 }, now), "processing");
});
test("ошибка даты не превращается в подтверждённый пропуск", () => {
  assert.equal(coverageState({ ...row, decision: "invalid_date", published_at: null }, now), "invalid_metadata");
});
test("обнаружение всех ссылок независимо от обработки сохраняет нормализацию и причины", async t => {
  t.mock.method(Date, "now", () => now);
  const source = { id: 1, name: "Fast Company", rss_url: "https://example.com/feed" };
  const items = [
    '<item><title>Article</title><link>https://example.com/a?partner=rss</link><pubDate>2026-11-10T11:00:00</pubDate></item>',
    '<item><title>Bad date</title><link>https://example.com/b</link><pubDate>broken</pubDate></item>',
    '<item><title>Old article</title><link>https://example.com/c</link><pubDate>2026-10-01T11:00:00Z</pubDate></item>',
  ].join("");
  const prepared = await prepareSource(source, Promise.resolve({
    xml: '<rss version="2.0"><channel><title>Test</title><link>https://example.com</link><description>Test</description>' + items + '</channel></rss>',
    status: 200, contentType: "application/rss+xml", age: null,
  }), diagnosticFor(source), undefined);
  assert.equal(prepared.fresh.length, 1);
  assert.deepEqual(prepared.observations.map(r => [r.link, r.decision]), [
    ["https://example.com/a", "eligible"], ["https://example.com/b", "invalid_date"],
  ]);
  assert.equal(prepared.observations[0].publishedAt, "2026-11-10T11:00:00.000Z");
});
