import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { createTransferCode } from "../../../src/lib/browserTransfer";
import { withViewerWrite } from "../../../src/lib/viewer";

export async function POST(request: NextRequest) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return NextResponse.json({ error: "Нужен JSON-запрос" }, { status: 415 });
  }
  const transfer = await withViewerWrite(createTransferCode);
  if (!transfer) return NextResponse.json({ error: "Попробуйте через минуту" }, { status: 429 });

  const link = new URL("/settings/transfer", request.url);
  // Фрагмент URL не отправляется серверу при открытии ссылки.
  link.hash = transfer.code;
  const qr = await QRCode.toDataURL(link.href, { width: 220 });
  return NextResponse.json({ ...transfer, qr }, { headers: { "Cache-Control": "no-store" } });
}
