import { NextResponse, type NextRequest } from "next/server";
import { BROWSER_COOKIE, BROWSER_COOKIE_OPTIONS, isBrowserToken } from "./src/lib/browserCookie";

// Номер браузера (DIS-65, см. src/lib/viewer.ts): выдаётся при первом визите и
// продлевается при каждом. Ставит его сервер, а не скрипт: куки, записанные
// скриптом, Safari стирает через 7 дней без визитов.

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function middleware(request: NextRequest) {
  const incoming = request.cookies.get(BROWSER_COOKIE)?.value;
  const token = isBrowserToken(incoming) ? incoming : newToken();
  // Новый номер виден и обработчику этого же запроса, а не только следующим.
  request.cookies.set(BROWSER_COOKIE, token);
  const response = NextResponse.next({ request });
  if (request.nextUrl.pathname !== "/api/transfer/reset") {
    response.cookies.set(BROWSER_COOKIE, token, BROWSER_COOKIE_OPTIONS);
  }
  return response;
}

// Страницы и API, кроме статики, картинок и прокси фото.
export const config = {
  matcher: ["/((?!_next/|favicons/|api/image-proxy|.*\\.(?:svg|png|jpg|ico|webmanifest|txt)$).*)"],
};
