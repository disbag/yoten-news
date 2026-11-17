import type { CheerioAPI } from "cheerio";

export function clipArticleText(text: string, limit = 12_000): string {
  if (text.length <= limit) return text;
  const prefix = text.slice(0, limit);
  const end = [...prefix.matchAll(/[.!?]["”’')\]]*(?=\s|$)/g)].at(-1);
  if (end && end.index! >= limit * 0.65) return prefix.slice(0, end.index! + end[0].length).trim();
  const space = prefix.lastIndexOf(" ");
  return prefix.slice(0, space >= limit * 0.65 ? space : limit).trim();
}

// Вызывать после чтения JSON-LD: скрипт может содержать полезные данные,
// но его исходный код никогда не является прозой для модели.
export function cleanArticleDom($: CheerioAPI, url: string): void {
  $("script, style, noscript, template").remove();
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host === "designwanted.com") $(".article-body .article-end").remove();
  if (host === "9to5mac.com") {
    $(".ad-disclaimer-container").remove();
    $(".post-content > div").each((_, el) => {
      if (/^You[’']re reading 9to5Mac\b/.test($(el).text().trim())) $(el).remove();
    });
    $(".post-content p").each((_, el) => {
      if (/^(?:9to5Mac is brought to you by\b|FTC:|Follow [^:]{1,80}:)/i.test($(el).text().trim())) $(el).remove();
    });
  }
  if (host === "variety.com") $(".vy-cx-page-content .article-tags, .vy-cx-page-content .o-comments-link").remove();
  if (host === "techcrunch.com") {
    $(".entry-content p").each((_, el) => {
      if (/^When you purchase through links in our articles\b/i.test($(el).text().trim())) $(el).remove();
    });
  }
  if (host === "remodelista.com" || host === "gardenista.com") {
    $("p, h2, h3").each((_, el) => {
      if (/^(?:See also|To continue this state of mind):?$/i.test($(el).text().trim())) {
        $(el).nextAll().remove();
        $(el).remove();
      }
    });
  }
  // Сохраняем границы блоков: <p>One.</p><p>Two.</p> не должно стать One.Two.
  $("p, h1, h2, h3, h4, li, blockquote, figcaption, tr, br").append("\n");
}
