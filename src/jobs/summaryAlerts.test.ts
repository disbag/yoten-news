import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../lib/db.js";
import { InvalidSummaryResponse, SummaryQualityError } from "../lib/summaryQuality.js";
import { flushSummaryAlerts, queueSummaryAlert, sendSummaryAlert, summaryAlertText, type SummaryAlert } from "./summaryAlerts.js";

const alert: SummaryAlert = {
  link: "https://example.com/story", title: "История <с заголовком>", source: "Издание", attempts: 4,
  reasons: ["lead:unfinished", "more:language"], action: "skip_quality",
};

test("только окончательная ошибка качества ставится в очередь", async t => {
  const calls: string[] = [];
  t.mock.method(pool, "query", async (sql: string) => { calls.push(sql); return { rows: [] }; });
  await queueSummaryAlert(alert, new InvalidSummaryResponse("empty"), "skip_quality");
  await queueSummaryAlert(alert, new Error("network"), "skip_quality");
  assert.equal(calls.length, 0);
  await queueSummaryAlert(alert, new SummaryQualityError(alert.reasons, 4), "skip_quality");
  assert.ok(calls.some(sql => sql.includes("ON CONFLICT (link) DO NOTHING")));
});

test("сообщение содержит причины, ссылку и результат; не использует HTML", async () => {
  let body: Record<string, unknown> = {};
  await sendSummaryAlert(alert, "test-token", "test-chat", async (_url, options) => {
    body = JSON.parse(String(options?.body));
    return new Response('{"ok":true}');
  });
  assert.equal(body.parse_mode, undefined);
  assert.match(String(body.text), /оборванное предложение/);
  assert.match(String(body.text), /другой язык/);
  assert.match(String(body.text), /Попыток: 4/);
  assert.ok(String(body.text).includes(alert.link));
  assert.match(summaryAlertText({ ...alert, action: "keep_cluster_summary" }), /Сохранён прежний пересказ/);
  assert.ok(summaryAlertText({ ...alert, title: "X".repeat(5000), link: "x".repeat(5000) }).length < 4096);
});

test("ошибка Telegram даже с HTTP 200 не считается доставкой", async () => {
  await assert.rejects(sendSummaryAlert(alert, "test", "chat", async () => new Response('{"ok":false}')));
  await assert.rejects(sendSummaryAlert(alert, "test", "chat", async () => new Response('{"ok":false}', { status: 429 })));
});

test("сбой доставки оставляет очередь; успешная доставка помечается и не повторяется", async t => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = "test";
  process.env.TELEGRAM_CHAT_ID = "test";
  t.after(() => {
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = oldChat;
  });
  let sent = false;
  const queries: string[] = [];
  t.mock.method(pool, "query", async (sql: string) => {
    queries.push(sql);
    if (sql.startsWith("SELECT")) return { rows: sent ? [] : [{ link: alert.link, payload: alert }] };
    if (sql.includes("SET sent_at")) sent = true;
    return { rows: [] };
  });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response(JSON.stringify({ ok: requests > 1 }));
  });
  await flushSummaryAlerts();
  assert.equal(sent, false);
  assert.ok(queries.some(sql => sql.includes("interval '30 minutes'")));
  // Следующий доступный запуск (таймер SQL в этом тесте замокан).
  await flushSummaryAlerts();
  assert.equal(sent, true);
  await flushSummaryAlerts();
  assert.equal(requests, 2);
});
