import test from "node:test";
import assert from "node:assert/strict";
import { fetchSourceFeed, prepareSource, processSource } from "./fetchAndProcess.js";
import { canonicalAbduzeedoLink, cmsFeedArticle } from "../lib/feedArticle.js";
import { diagnosticFor } from "./sourceDiagnostics.js";
import { pool } from "../lib/db.js";

const source = { id: 350, name: "Abduzeedo", rss_url: "https://abduzeedo.com/rss.xml" };
const cmsUrl = "https://cms.abduzeedo.com/rss.xml";
const text = "A studio designed a distinctive visual identity using photography and typography. ".repeat(10).trim();
const html = `<span>Автор, дата и заголовок не входят в тело</span><div class="field--name-field-image"><img src="/sites/default/files/cover.jpg"></div><div class="field--name-body"><p>${text}</p><img src="/sites/default/files/a.jpg"><img src="/sites/default/files/b.jpg"></div>`;
const xml = (host = "cms.abduzeedo.com", content = html) => `<rss version="2.0"><channel><title>Abduzeedo</title><description>Design</description><link>https://${host}</link><item><title>A design project</title><link>https://${host}/story/</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate><description><![CDATA[${content}]]></description></item></channel></rss>`;

test("CMS RSS: полный текст, обложка и фото без служебных полей", () => {
  const result = cmsFeedArticle(html, "https://abduzeedo.com/story/")!;
  assert.equal(result.excerpt, text);
  assert.equal(result.image, "https://cms.abduzeedo.com/sites/default/files/cover.jpg");
  assert.deepEqual(result.gallery, ["https://cms.abduzeedo.com/sites/default/files/a.jpg", "https://cms.abduzeedo.com/sites/default/files/b.jpg"]);
  assert.equal(cmsFeedArticle("<p>Короткий обычный RSS</p>", "https://abduzeedo.com/story/"), undefined);
  assert.equal(canonicalAbduzeedoLink("https://cms.abduzeedo.com/story?utm_source=rss"), "https://abduzeedo.com/story/");
});

test("здоровая CMS — единственный запрос, публичные ссылки совпадают с резервом", async t => {
  t.mock.method(Date, "now", () => Date.parse("2026-11-16T12:00:00Z"));
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => { calls.push(String(url)); return new Response(xml()); });
  const response = await fetchSourceFeed(source);
  assert.deepEqual(calls, [cmsUrl]);
  assert.equal(response.fetchedUrl, cmsUrl);
  const d = diagnosticFor(source);
  const prepared = await prepareSource(source, Promise.resolve(response), d, undefined);
  assert.equal(d.fetchedUrl, cmsUrl);
  assert.equal(prepared.fresh[0].link, "https://abduzeedo.com/story/");
  assert.equal(prepared.observations[0].link, "https://abduzeedo.com/story/");
  t.mock.method(pool, "query", async (_sql: string, values: unknown[]) => {
    assert.deepEqual(values[0], ["https://abduzeedo.com/story/"]);
    return { rows: [{ link: "https://abduzeedo.com/story/" }] };
  });
  await processSource(source, Promise.resolve(response), { count: 100 }, d, undefined, { count: 50 }, () => {}, { count: 10 }, prepared);
  assert.equal(d.known, 1);
  assert.equal(d.attempted, 0);
});

test("отказ, HTML 200, пустой RSS и RSS без тела включают обычный RSS", async t => {
  for (const broken of [new Response("Denied", { status: 403 }), new Response("<html>Challenge</html>"), new Response("<rss version='2.0'><channel><title>Empty</title></channel></rss>"), new Response(xml("cms.abduzeedo.com", "Teaser"))]) {
    const calls: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string) => { calls.push(String(url)); return calls.length === 1 ? broken : new Response(xml("abduzeedo.com", "Teaser")); });
    const response = await fetchSourceFeed(source);
    assert.deepEqual(calls, [cmsUrl, source.rss_url]);
    assert.equal(response.fetchedUrl, source.rss_url);
    assert.ok(response.primaryFeedError);
    t.mock.restoreAll();
  }
});

test("сетевая ошибка CMS ограничена двумя попытками, резерв — одной", async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => { calls.push(String(url)); throw new Error("network unavailable"); });
  await assert.rejects(fetchSourceFeed(source), /Основной RSS:.*резервный RSS:/);
  assert.deepEqual(calls, [cmsUrl, cmsUrl, source.rss_url]);
});

test("после восстановления снова используется CMS; чужие фиды не переключаются", async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => { calls.push(String(url)); return new Response(xml()); });
  await fetchSourceFeed(source);
  await fetchSourceFeed({ name: "GameSpot", rss_url: "https://www.gamespot.com/feeds/mashup/" });
  assert.deepEqual(calls, [cmsUrl, "https://www.gamespot.com/feeds/mashup/"]);
});
