import assert from "node:assert/strict";
import test from "node:test";
import { summarize, GroqRequestTooLargeError, GroqLimitError } from "../lib/groq.js";

test("слишком большой запрос с HTTP 429 не повторяется", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: { message: "Request too large for model on output tokens per minute (OTPM): Limit 1000, Requested 1500" } }, { status: 429 });
  });
  await assert.rejects(summarize("Test", "Text"), err => {
    assert.ok(err instanceof GroqRequestTooLargeError);
    assert.match(err.message, /OTPM.*limit=1000, requested=1500/);
    return true;
  });
  assert.equal(calls, 1);
});

test("HTTP 413 прекращает запрос после первой попытки", async t => {
  const request = t.mock.method(globalThis, "fetch", async () => new Response("", { status: 413 }));
  await assert.rejects(summarize("Test", "Text"), GroqRequestTooLargeError);
  assert.equal(request.mock.callCount(), 1);
});

test("суточная квота сохраняет отдельный тип ошибки", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    error: { message: "Rate limit on tokens per day (TPD): Limit 200000" },
  }, { status: 429 }));
  await assert.rejects(summarize("Test", "Text"), GroqLimitError);
});

test("временный лимит допускает успешный повтор после Retry-After", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls === 1
      ? Response.json({ error: { message: "Rate limit reached" } }, { status: 429, headers: { "retry-after": "2" } })
      : Response.json({ choices: [{ finish_reason: "stop", message: { content: "Готово" } }] });
  });
  const pending = summarize("Test", "Text");
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(2499);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  assert.equal(await pending, "Готово");
  assert.equal(calls, 2);
});

test("без Retry-After временный лимит ждёт 30 секунд и ограничивает повторы", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: { message: "Rate limit reached" } }, { status: 429 });
  });
  const pending = assert.rejects(summarize("Test", "Text"), /минутный лимит не освободился/);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(30_499);
    assert.equal(calls, attempt);
    t.mock.timers.tick(1);
  }
  await pending;
  assert.equal(calls, 4);
});
