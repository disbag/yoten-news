import { load } from "cheerio";

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Приводим официальную News Sitemap к формату, который уже умеет читать
// сборщик. lastmod означает изменение страницы и не заменяет дату публикации.
export function newsSitemapRss(input: string, sitemapUrl: string): string {
  const $ = load(input, { xml: true });
  const origin = new URL(sitemapUrl).origin;
  const items: string[] = [];
  const seen = new Set<string>();
  for (const entry of $("urlset > url").toArray()) {
    const node = $(entry);
    const link = node.children("loc").first().text().trim();
    const news = node.children("news\\:news").first();
    const title = news.children("news\\:title").first().text().trim();
    const publishedAt = news.children("news\\:publication_date").first().text().trim();
    const date = Date.parse(publishedAt);
    if (!title || !Number.isFinite(date) || !link.startsWith(origin + "/") || seen.has(link)) continue;
    seen.add(link);
    const image = node.children("image\\:image").first().children("image\\:loc").first().text().trim();
    const media = image.startsWith("https://cdn.mos.cms.futurecdn.net/")
      ? `<media:content medium="image" url="${xml(image)}"/>`
      : "";
    items.push(`<item><title>${xml(title)}</title><link>${xml(link)}</link><pubDate>${new Date(date).toUTCString()}</pubDate><description></description>${media}</item>`);
  }
  if (!items.length) throw new Error("Карта новостей не содержит пригодных статей");
  return `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>${xml(origin)}</title><link>${xml(origin)}</link>${items.join("")}</channel></rss>`;
}
