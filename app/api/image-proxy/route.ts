import { NextRequest, NextResponse } from "next/server";

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

  let res: Response;
  try {
    res = await fetch(target.toString(), { headers: BROWSER_HEADERS });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
  if (!res.ok || !res.body) return new NextResponse(null, { status: 502 });

  return new NextResponse(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
      // Картинки статей не меняются задним числом — кешируем надолго и на
      // стороне браузера, и на CDN/edge, если он когда-нибудь появится.
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
