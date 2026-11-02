import assert from "node:assert/strict";
import test from "node:test";
import { reportChunks, sourceHealth, volumeBaseline } from "./healthDiagnostics.js";
import { diagnosticFor } from "./sourceDiagnostics.js";

const now = Date.parse("2026-11-02T11:45:00Z");
function record(at: string) {
  return { ...diagnosticFor({ id: 1, name: "Издание", rss_url: "https://example.com/rss" }), at,
    items: 10, newestItemAt: "2026-10-30T20:00:00Z" };
}
test("отсутствие свежих публикаций в выходные — наблюдение, а не техническая ошибка", () => {
  const result = sourceHealth([record("2026-11-02T11:00:00Z"), record("2026-11-02T11:30:00Z")], now);
  assert.equal(result.problems.length, 0);
  assert.match(result.notes[0], /в RSS нет публикаций/);
});
test("повторный отказ RSS и пустой RSS распознаются отдельно", () => {
  const records = [record("2026-11-02T11:00:00Z"), record("2026-11-02T11:30:00Z")];
  assert.match(sourceHealth(records.map(r => ({ ...r, feedError: "Status code 402" })), now).problems[0], /RSS недоступен/);
  assert.match(sourceHealth(records.map(r => ({ ...r, items: 0 })), now).problems[0], /пустую ленту/);
  assert.equal(sourceHealth([{ ...records[0], feedError: "timeout" }], now).problems.length, 0);
});
test("ошибка обработчика отличается от плановой ограниченной догрузки", () => {
  const records = [record("2026-11-02T11:00:00Z"), record("2026-11-02T11:30:00Z")];
  const broken = records.map(r => ({ ...r, attempted: 2, summaryErrors: 2, retryNeeded: true }));
  assert.match(sourceHealth(broken, now).problems[0], /обработка не завершилась/);
  const bounded = records.map(r => ({ ...r, deferred: 4, retryNeeded: true }));
  assert.equal(sourceHealth(bounded, now).problems.length, 0);
  assert.match(sourceHealth(bounded, now).notes[0], /догрузку ожидают 4/);
});
test("сломанный дополнительный фид не маскируется исправным основным", () => {
  const records = [record("2026-11-02T11:00:00Z"), record("2026-11-02T11:30:00Z")];
  const result = sourceHealth([...records, ...records.map(r => ({ ...r, sourceId: 2, rssUrl: "https://example.com/books/rss", feedError: "403" }))], now);
  assert.match(result.problems[0], /books\/rss/);
});
test("для воскресенья используются прошлые воскресенья, а не будни", () => {
  const history = [{ day: "2026-10-18", name: "X", articles: 2 }, { day: "2026-10-25", name: "X", articles: 4 },
    { day: "2026-10-26", name: "X", articles: 100 }, { day: "2026-11-01", name: "X", articles: 0 }];
  assert.equal(volumeBaseline(history, "X", "2026-11-01"), 3);
  assert.equal(volumeBaseline(history.slice(1), "X", "2026-11-01"), null);
});
test("при малой истории сравниваются сопоставимые дни; нулевые дни сохраняются", () => {
  const history = [{ day: "2026-10-28", name: "X", articles: 0 }, { day: "2026-10-29", name: "X", articles: 6 }, { day: "2026-10-30", name: "X", articles: 6 }];
  assert.equal(volumeBaseline(history, "X", "2026-11-02"), 4);
  assert.equal(volumeBaseline(history, "X", "2026-11-01"), null);
});
test("длинный отчёт разделяется между строками с сохранением HTML", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `• <b>Издание ${i}</b> — нет свежих публикаций &amp; ошибок`);
  const chunks = reportChunks(lines.join("\n"));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(c => c.length <= 3800));
  assert.equal(chunks.join("\n"), lines.join("\n"));
});
