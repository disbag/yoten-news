import { NextRequest, NextResponse } from "next/server";
import { claimTransferCode } from "../../../../src/lib/browserTransfer";
import { getBrowserIdentity } from "../../../../src/lib/viewer";

export async function POST(request: NextRequest) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return NextResponse.json({ error: "Нужен JSON-запрос" }, { status: 415 });
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.code !== "string") return NextResponse.json({ error: "Введите код переноса" }, { status: 400 });
  const browser = await getBrowserIdentity();
  if (!browser) return NextResponse.json({ error: "Обновите страницу и попробуйте снова" }, { status: 400 });

  const result = await claimTransferCode(browser, body.code);
  if (result === "blocked") {
    return NextResponse.json({ error: "Слишком много попыток. Попробуйте через 10 минут" }, { status: 429 });
  }
  if (result === "invalid") return NextResponse.json({ error: "Код неверен, истёк или уже использован" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
