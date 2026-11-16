import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { fetchOgTags, parseArticleHtml, extractFeedGallery } from "../lib/ogTags.js";
import { descriptionArticle, sufficientFeedArticle } from "../lib/feedArticle.js";
import { SOURCES } from "../config/sources.js";

const text = "The design studio created a new identity with typography and photographs for the project. ".repeat(10);
const cmsHtml = `<article><footer>Submitted by editor</footer><div class="field--name-body"><p>${text}</p><img src="/sites/default/files/one.jpg"><img src="/sites/default/files/two.jpg"></div><aside>Other articles</aside></article>`;

test("CMS: только тело статьи и абсолютные адреса галереи", () => {
  const result = parseArticleHtml(cmsHtml, "https://cms.abduzeedo.com/story", "article .field--name-body", "abduzeedo");
  assert.equal(result.excerpt, text.trim());
  assert.deepEqual(result.gallery, ["https://cms.abduzeedo.com/sites/default/files/one.jpg", "https://cms.abduzeedo.com/sites/default/files/two.jpg"]);
});

test("Abduzeedo: одна резервная попытка при 403 и при пустом HTTP 200", async t => {
  for (const status of [403, 200]) {
    const calls: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string) => {
      calls.push(String(url));
      return calls.length === 1 ? new Response("<p>Challenge</p>", { status }) : new Response(cmsHtml);
    });
    const result = await fetchOgTags("https://abduzeedo.com/story/?utm_source=rss", ".article-body", "abduzeedo");
    assert.equal(result.retrieval, "abduzeedo-cms");
    assert.equal(result.excerpt, text.trim());
    assert.deepEqual(calls, ["https://abduzeedo.com/story/?utm_source=rss", "https://cms.abduzeedo.com/story"]);
    t.mock.restoreAll();
  }
});

test("Abduzeedo: исправная страница не требует CMS", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(`<div class="article-body">${text}</div>`));
  assert.equal((await fetchOgTags("https://abduzeedo.com/story", ".article-body", "abduzeedo")).retrieval, undefined);
  assert.equal(fetch.mock.callCount(), 1);
});

test("Abduzeedo: отказ CMS не повторяется, заглушка 200 не становится статьёй", async t => {
  for (const status of [403, 503, 200]) {
    // Первый отказ всегда окончательный; 503 проверяем только у CMS.
    let count = 0;
    const fetch = t.mock.method(globalThis, "fetch", async () => new Response("<p>Access denied</p>", { status: ++count === 1 ? 403 : status }));
    await assert.rejects(fetchOgTags("https://abduzeedo.com/story", ".article-body", "abduzeedo"), /CMS:/);
    assert.equal(fetch.mock.callCount(), 2);
    t.mock.restoreAll();
  }
});

test("CMS fallback не применяется к другим доменам", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("Denied", { status: 403 }));
  await assert.rejects(fetchOgTags("https://example.com/story", undefined, "abduzeedo"), /403/);
  assert.equal(fetch.mock.callCount(), 1);
});

test("Полный description: без скриптов, с фото; короткий анонс требует страницу", () => {
  const html = descriptionArticle(`<script>${"junk ".repeat(200)}</script><p>${text}</p><img src="https://www.gamespot.com/wp-content/uploads/a.jpg"><img src="https://www.gamespot.com/wp-content/uploads/b.jpg">`)!;
  assert.ok(!html.includes("junk"));
  assert.ok(sufficientFeedArticle(cheerio.load(html).text()));
  assert.equal(extractFeedGallery(html, "https://www.gamespot.com/story", "gamespot").length, 2);
  assert.equal(sufficientFeedArticle("Short teaser"), false);
  assert.equal(sufficientFeedArticle(undefined), false);
  assert.equal(descriptionArticle(undefined), undefined);
  assert.deepEqual(SOURCES.filter(s => s.feedDescriptionIsFull).map(s => s.name).sort(), ["Fast Company", "GameSpot"]);
});
