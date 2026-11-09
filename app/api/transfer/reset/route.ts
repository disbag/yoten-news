import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { BROWSER_COOKIE, BROWSER_COOKIE_OPTIONS } from "../../../../src/lib/browserCookie";
import { resetBrowser } from "../../../../src/lib/browserTransfer";
import { getBrowserIdentity, LEGACY_SESSION_COOKIE } from "../../../../src/lib/viewer";

export async function POST(request: NextRequest) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return NextResponse.json({ error: "Нужен JSON-запрос" }, { status: 415 });
  }
  const browser = await getBrowserIdentity();
  if (browser) await resetBrowser(browser.hash);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(BROWSER_COOKIE, randomBytes(32).toString("base64url"), BROWSER_COOKIE_OPTIONS);
  response.cookies.delete(LEGACY_SESSION_COOKIE);
  return response;
}
