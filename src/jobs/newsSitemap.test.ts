import assert from "node:assert/strict";
import test from "node:test";
import { fetchSourceFeed, prepareSource } from "./fetchAndProcess.js";
import { diagnosticFor } from "./sourceDiagnostics.js";

const source = { id: 1, name: "Wallpaper", rss_url: "https://www.wallpaper.com/feeds.xml" };
const sitemap = "https://www.wallpaper.com/sitemap-news.xml";
const entry = (link: string, date: string) => `<url><loc>${link}</loc><lastmod>2026-11-24</lastmod>
  <news:news><news:publication_date>${date}</news:publication_date><news:title>Design &amp; craft</news:title></news:news>
  <image:image><image:loc>https://cdn.mos.cms.futurecdn.net/example.jpg</image:loc></image:image></url>`;
const good = entry("https://www.wallpaper.com/design/example", "2026-11-24T10:00:00Z");
const map = `<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${good}${good}${entry("https://example.com/offsite", "2026-11-24T10:00:00Z")}${entry("https://www.wallpaper.com/design/no-date", "")}
</urlset>`;

test("при отказе RSS карта передаёт только уникальные статьи с датой публикации", async t => {
  t.mock.method(Date, "now", () => Date.parse("2026-11-24T12:00:00Z"));
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    return url === sitemap ? new Response(map) : new Response("Not Found", { status: 404 });
  });
  const response = await fetchSourceFeed(source);
  const diagnostic = diagnosticFor(source);
  const { fresh } = await prepareSource(source, Promise.resolve(response), diagnostic, undefined);
  assert.deepEqual(calls, [source.rss_url, sitemap]);
  assert.equal(diagnostic.fetchedUrl, sitemap);
  assert.equal(diagnostic.primaryFeedError, "Status code 404");
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].link, "https://www.wallpaper.com/design/example");
  assert.equal(fresh[0].isoDate, "2026-11-24T10:00:00.000Z");
  assert.equal(fresh[0].title, "Design & craft");
  assert.equal(fresh[0].content, "");
  assert.match(response.xml, /<media:content medium="image" url="https:\/\/cdn\.mos\.cms\.futurecdn\.net\/example\.jpg"/);
});

test("здоровый RSS не обращается к карте, при двойном отказе записываются обе причины", async t => {
  const calls: string[] = [];
  const fetchMock = t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    return new Response(`<rss version="2.0"><channel><title>Wallpaper</title><item><title>Design</title><link>https://www.wallpaper.com/design/example</link><pubDate>Tue, 24 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`);
  });
  assert.equal((await fetchSourceFeed(source)).fetchedUrl, source.rss_url);
  assert.deepEqual(calls, [source.rss_url]);
  fetchMock.mock.mockImplementation(async (url: string) =>
    url === sitemap ? new Response("<urlset/>") : new Response("Not Found", { status: 404 }),
  );
  await assert.rejects(fetchSourceFeed(source), /Основной RSS: Status code 404; резервный RSS: Карта новостей не содержит пригодных статей/);
});

test("основной и дополнительные фиды Guardian получают идентификатор сборщика", async t => {
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    assert.equal(new Headers(options.headers).get("User-Agent"), "Yoten/1.0 (+https://yoten.io)");
    return new Response("<rss version='2.0'><channel/></rss>");
  });
  for (const section of ["world", "artanddesign", "books", "travel"]) {
    const url = `https://www.theguardian.com/${section}/rss`;
    assert.equal((await fetchSourceFeed({ name: "The Guardian", rss_url: url })).status, 200);
  }
  assert.equal(fetchMock.mock.callCount(), 4);
});
