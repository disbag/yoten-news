import * as cheerio from "cheerio";
import { parseArticleHtml, type OgTags } from "./ogTags.js";
import { cleanArticleDom } from "./articleText.js";

export function cleanFeedMarkup(html: string | undefined, link: string): string | undefined {
  if (!html) return undefined;
  const $ = cheerio.load(html);
  cleanArticleDom($, link);
  return $.html();
}

export function canonicalAbduzeedoLink(link: string): string {
  try {
    const url = new URL(link);
    if (!["cms.abduzeedo.com", "www.abduzeedo.com", "abduzeedo.com"].includes(url.hostname)) return link;
    url.protocol = "https:";
    url.hostname = "abduzeedo.com";
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") + "/";
    return url.href;
  } catch { return link; }
}

// Drupal RSS содержит также автора, дату и заголовок вне тела статьи.
export function cmsFeedArticle(html: string | undefined, link: string): OgTags | undefined {
  if (!html) return undefined;
  const $ = cheerio.load(html);
  const body = $(".field--name-body").first();
  if (!body.length) return undefined;
  body.find("script, style, iframe, nav, aside").remove();
  const base = new URL(canonicalAbduzeedoLink(link));
  if (base.hostname !== "abduzeedo.com") return undefined;
  base.hostname = "cms.abduzeedo.com";
  const article = parseArticleHtml(`<article><div class="field--name-body">${body.html()}</div></article>`, base.href, ".field--name-body", "abduzeedo");
  const cover = $(".field--name-field-image img").first().attr("src");
  if (cover) {
    try {
      const url = new URL(cover, base);
      if (url.protocol === "https:" && url.hostname === "cms.abduzeedo.com" && url.pathname.startsWith("/sites/default/files/")) article.image = url.href;
    } catch { /* Не подменяем обложку невалидным адресом. */ }
  }
  return article.excerpt ? article : undefined;
}

// Только для проверенных источников: обычный description часто лишь анонс.
export function descriptionArticle(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const $ = cheerio.load(html);
  $("script, style, iframe, nav, aside").remove();
  return $.html();
}

export function sufficientFeedArticle(text: string | undefined): boolean {
  return (text?.trim().length ?? 0) >= 600;
}
