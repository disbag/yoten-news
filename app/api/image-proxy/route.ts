import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../src/lib/db";

// Некоторые издания (Rolling Stone, Variety, Hollywood Reporter — все три на
// инфраструктуре Penske Media) отдают картинку нормально на серверный
// запрос (см. fetchOgTags в src/lib/ogTags.ts, откуда и берётся image_url),
// но блокируют её же при прямой хотлинк-загрузке из чужого домена в браузере
// — редиректят на tollbit.<domain> (анти-бот/AI-пейволл сервис) и отдают 402.
// Тот же URL, вставленный напрямую в <img src>, у пользователя в браузере
// просто не грузится, хотя в базе (и при og:image-скрапинге) всё в порядке.
// Проксируем через свой бэкенд — тот же серверный запрос, что уже работает
// при сборе новостей, только теперь ещё и отдаёт байты клиенту сам.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

// Telegraph — противоположный случай: браузерный User-Agent там как раз
// триггерит анти-бот блокировку (402, тот же паттерн, что у Penske Media
// выше, только наоборот), а обычный серверный запрос БЕЗ заголовков
// проходит нормально. Пробуем сперва как для Penske (это большинство
// изданий), и если не получилось — повторяем совсем без заголовков.
async function fetchImage(url: string): Promise<Response> {
  const withBrowserUA = await fetch(url, { headers: BROWSER_HEADERS });
  if (withBrowserUA.ok) return withBrowserUA;
  console.error(`[image-proxy] browser UA -> ${withBrowserUA.status} для ${url}`);
  try {
    const bare = await fetch(url);
    if (bare.ok) return bare;
    console.error(`[image-proxy] bare -> ${bare.status} для ${url}`);
  } catch (err) {
    console.error(`[image-proxy] bare бросил ошибку для ${url}:`, err);
  }
  return withBrowserUA;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("Missing url", { status: 400 });

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return new NextResponse("Invalid url", { status: 400 });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return new NextResponse("Invalid protocol", { status: 400 });
  }

  // Проксируем только картинки, которые реально есть в ленте. Без этого
  // прокси забирал ЛЮБОЙ URL и отдавал его с нашего домена с исходным
  // Content-Type: ?url=<страница злоумышленника> превращался в HTML+JS,
  // исполняемый в origin сайта (XSS/фишинг от имени Yoten), плюс открытый
  // прокси для чужого трафика и запросов к внутренним адресам (SSRF).
  const { rowCount } = await pool.query(
    "SELECT 1 FROM articles WHERE image_url = $1 OR $1 = ANY(image_urls) LIMIT 1",
    [url]
  );
  if (!rowCount) return new NextResponse("Unknown image", { status: 404 });

  let res: Response;
  try {
    res = await fetchImage(target.toString());
  } catch {
    return new NextResponse(null, { status: 502 });
  }
  if (!res.ok || !res.body) return new NextResponse(null, { status: 502 });

  // Даже с URL из базы издание может вернуть HTML-заглушку со статусом 200
  // (анти-бот, пейволл) — такое не отдаём, <img onError> в FeedCard просто
  // скроет картинку.
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) return new NextResponse(null, { status: 502 });

  return new NextResponse(res.body, {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      // SVG — тоже image/*, но может содержать скрипты при открытии URL
      // напрямую (не через <img>). sandbox запрещает их исполнение.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      // Картинки статей не меняются задним числом — кешируем надолго и на
      // стороне браузера, и на CDN/edge, если он когда-нибудь появится.
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
