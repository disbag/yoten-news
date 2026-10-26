import { NextResponse, type NextRequest } from "next/server";

// Номер браузера (DIS-65, см. src/lib/viewer.ts): выдаётся при первом визите и
// продлевается при каждом. Ставит его сервер, а не скрипт: куки, записанные
// скриптом, Safari стирает через 7 дней без визитов.
const BROWSER_COOKIE = "yoten_browser";
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60; // больше Chrome не разрешает

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get(BROWSER_COOKIE)?.value ?? newToken();
  // Новый номер виден и обработчику этого же запроса, а не только следующим.
  request.cookies.set(BROWSER_COOKIE, token);
  const response = NextResponse.next({ request });
  response.cookies.set(BROWSER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}

// Страницы и API, кроме статики, картинок и прокси фото.
export const config = {
  matcher: ["/((?!_next/|favicons/|api/image-proxy|.*\\.(?:svg|png|jpg|ico|webmanifest|txt)$).*)"],
};
