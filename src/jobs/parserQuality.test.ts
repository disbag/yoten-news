import test from "node:test";
import assert from "node:assert/strict";
import { parseArticleHtml } from "../lib/ogTags.js";
import { cleanFeedMarkup } from "../lib/feedArticle.js";
import { clipArticleText } from "../lib/articleText.js";
import { describeContext } from "../lib/contentQuality.js";
import { SOURCES } from "../config/sources.js";
import { diagnosticFor, recordExtraction } from "./sourceDiagnostics.js";

// Структура реальных шаблонов из аудита; редакционный текст заменён.
const body = "The studio developed a visual identity with a new typeface and commissioned original photographs. ";
function parse(name: string, html: string) {
  const s = SOURCES.find(s => s.name === name)!;
  return parseArticleHtml(html, s.homepageUrl, s.contentSelector, s.gallery);
}

test("THR/Variety: скрипты не расходуют контекст и не вытесняют окончание", () => {
  for (const name of ["The Hollywood Reporter", "Variety"]) {
    const content = `<p>${body.repeat(90)}</p><script>${"window.advertising();".repeat(1000)}</script><style>ad{display:block}</style><p>The final paragraph describes the completed project.</p>`;
    const html = name === "Variety" ? `<div class="vy-cx-page-content">${content}<div class="article-tags">Unrelated names</div></div>` : `<div class="a-content"><div class="pmc-paywall">${content}</div></div>`;
    const result = parse(name, html);
    assert.ok(result.excerpt?.endsWith("The final paragraph describes the completed project."));
    assert.doesNotMatch(result.excerpt!, /window|advertising|display|Unrelated/);
  }
});

test("House & Garden: короткий JSON-LD не заменяет тело и подписи слайдов", () => {
  const teaser = body.repeat(3);
  const html = `<script type="application/ld+json">${JSON.stringify({ articleBody: teaser })}</script><article><div data-testid="BodyWrapper"><p>${body.repeat(20)}</p></div><figure class="GallerySlide-test"><img src="https://media.houseandgarden.co.uk/photos/abc/master/w_1000/one.jpg"><figcaption><div class="GallerySlideCaptionDek-test">A distinctive staircase connects the floors.</div></figcaption></figure><figure class="AssetEmbedWrapper-test"><img src="https://media.houseandgarden.co.uk/photos/def/master/w_1000/two.jpg"></figure></article>`;
  const result = parse("House & Garden", html);
  assert.ok(result.excerpt!.length > teaser.length * 3);
  assert.match(result.excerpt!, /staircase/);
  assert.equal(result.gallery?.length, 2);
});

test("DesignWanted: новый шаблон, без автора и сторонних кадров", () => {
  const result = parse("DesignWanted", `<article class="article-body"><p>${body.repeat(4)}</p><figure class="wp-block-image"><img src="http://designwanted.com/wp-content/uploads/one.jpg"></figure><figure class="wp-block-image"><img src="http://designwanted.com/wp-content/uploads/two.jpg"></figure><div class="article-end"><p>Biography of the author</p></div></article><img src="https://designwanted.com/wp-content/uploads/unrelated.jpg">`);
  assert.doesNotMatch(result.excerpt!, /Biography/);
  assert.equal(result.extraction?.selectorMiss, false);
  assert.deepEqual(result.gallery, ["https://designwanted.com/wp-content/uploads/one.jpg", "https://designwanted.com/wp-content/uploads/two.jpg"]);
});

test("Hearst: встроенные кадры и Motor Trend, без чужой подгалереи", () => {
  for (const name of ["Car and Driver", "House Beautiful", "Motor Trend"]) {
    const images = `<img src="https://hips.hearstapps.com/hmg-prod/images/one.jpg?resize=300:*"><img src="https://hips.hearstapps.com/hmg-prod/images/two.jpg?resize=600:*">`;
    const content = name === "Motor Trend" ? `<div data-nitrous-content-readable="true"><div data-component="ImageElement">${images}</div></div>` : `<div class="article-body"><div class="embed">${images}</div></div>`;
    const r = parse(name, `${content}<aside><a href="/photos/unrelated"><img src="https://hips.hearstapps.com/hmg-prod/images/unrelated.jpg"></a></aside>`);
    assert.equal(r.gallery?.length, 2);
    assert.ok(r.gallery?.every(url => !url.includes("unrelated") && url.includes("1280")));
  }
});

test("Hearst: отдельная галерея сохраняет приоритет над ссылками на другие фото", () => {
  const r = parse("Car and Driver", `<div class="listicle-slides"><img src="https://hips.hearstapps.com/hmg-prod/images/a.jpg"><img src="https://hips.hearstapps.com/hmg-prod/images/b.jpg"></div><a href="/photos/other"><img src="https://hips.hearstapps.com/hmg-prod/images/other.jpg"></a>`);
  assert.equal(r.gallery?.length, 2);
  assert.ok(r.gallery?.every(url => !url.includes("other")));
});

test("9to5Mac/TechCrunch: сохраняются новости и списки, исключаются служебные блоки", () => {
  const nine = parse("9to5Mac", `<div class="post-content"><p>9to5Mac is brought to you by Sponsor.</p><p>${body}</p><ul><li>Feature one</li><li>Feature two</li></ul><div class="ad-disclaimer-container">Affiliate links</div><div>You’re reading 9to5Mac — subscribe.</div></div><p>${"Author biography. ".repeat(20)}</p>`);
  assert.match(nine.excerpt!, /Feature one Feature two/);
  assert.doesNotMatch(nine.excerpt!, /Sponsor|Affiliate|subscribe|biography/);
  const tc = parse("TechCrunch", `<div class="entry-content"><p>${body.repeat(3)}</p><p>When you purchase through links in our articles, we earn money.</p></div><p>${"Author biography. ".repeat(20)}</p>`);
  assert.doesNotMatch(tc.excerpt!, /earn money|biography/);
});

test("RSS Remodelista/Gardenista: текст и фото остаются, related-хвост и скрипты удаляются", () => {
  for (const host of ["remodelista.com", "gardenista.com"]) {
    const html = cleanFeedMarkup(`<p>${body}</p><img src="photo.jpg"><h2>See also:</h2><ul><li>Another unrelated project</li></ul><script>window.ads()</script>`, `https://www.${host}/post`)!;
    assert.match(html, /photo.jpg/);
    assert.doesNotMatch(html, /unrelated|window.ads/);
  }
});

test("метаданные контекста не зависят от наличия og:description", () => {
  const rss = describeContext(body.repeat(20), "rss");
  assert.equal(rss.isThin, false);
  assert.equal(describeContext("A short factual teaser.", "description").isThin, true);
  assert.equal(describeContext(" ".repeat(2000), "page").isThin, true);
  assert.equal(describeContext("a\n b", "rss").fingerprint, describeContext("a b", "page").fingerprint);
});

test("диагностика ловит тихий fallback и ограничивает примеры", () => {
  const d = diagnosticFor({ id: 1, name: "Test", rss_url: "https://example.com/rss" });
  const parsed = parseArticleHtml(`<article><p>${body.repeat(4)}</p></article>`, "https://example.com", ".disappeared");
  for (let i = 0; i < 15; i++) recordExtraction(d, `https://example.com/${i}`, describeContext(parsed.excerpt!, "page"), parsed.extraction);
  assert.equal(d.extraction?.selectorMisses, 15);
  assert.equal(d.extraction?.examples.length, 10);
  assert.equal(d.extraction?.methods.article, 15);
});

test("обрезка текста сохраняет последнее завершённое предложение", () => {
  const complete = body.repeat(100).trim();
  const result = clipArticleText(complete + " A final sentence that cannot fit.", complete.length + 14);
  assert.equal(result, complete);
});
