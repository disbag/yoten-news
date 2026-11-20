import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../lib/db.js";
import { repairSnapshot, recordNoText, claimContentRepair, resolveContentRepair } from "./contentRepairs.js";

const item = { title: "Article", link: "https://example.com/article", content: "x".repeat(30000), enclosure: { url: "https://example.com/image.jpg", length: 42 } };
test("снимок ограничивает текст и сохраняет обложку для исчезнувшего RSS item", () => {
  const snapshot = repairSnapshot(item);
  assert.equal(snapshot.content?.length, 24000);
  assert.deepEqual(snapshot.enclosure, item.enclosure);
  assert.equal(item.content.length, 30000);
});
test("отсутствие текста регистрируется без Telegram на первой и последней попытках", async t => {
  const calls: string[] = [];
  let state = "pending";
  t.mock.method(pool, "query", async (sql: string) => {
    calls.push(sql);
    return { rows: sql.includes("RETURNING *") ? [{ ...item, item, source_id: 1, attempts: state === "pending" ? 1 : 3, state }] : [], rowCount: 1 };
  });
  assert.equal(await recordNoText({ id: 1, name: "Test" }, item), true);
  assert.equal(calls.length, 1);
  state = "exhausted";
  assert.equal(await recordNoText({ id: 1, name: "Test" }, item), false);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(sql => sql.includes("INSERT INTO article_content_repairs")));
});
test("запрещённая попытка не запускается; разрешённая атомарно расходует бюджет", async t => {
  let allowed = false;
  t.mock.method(pool, "query", async (sql: string) => {
    assert.match(sql, /attempts = attempts \+ 1/);
    assert.match(sql, /attempts < 3/);
    assert.match(sql, /next_attempt_at <= now\(\)/);
    assert.match(sql, /24 hours/);
    return { rows: [], rowCount: allowed ? 1 : 0 };
  });
  assert.equal(await claimContentRepair(item.link), false);
  allowed = true;
  assert.equal(await claimContentRepair(item.link), true);
});
test("завершение повтора не удаляет причину окончательной фильтрации", async t => {
  const calls: string[] = [];
  t.mock.method(pool, "query", async (sql: string) => { calls.push(sql); return { rows: [] }; });
  await resolveContentRepair(item.link);
  assert.match(calls[1], /reason = 'no_text'/);
});
