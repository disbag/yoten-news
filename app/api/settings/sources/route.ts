import { NextRequest, NextResponse } from "next/server";
import { withViewerWrite } from "../../../../src/lib/viewer";
import { setSourceEnabled } from "../../../../src/lib/sourcePrefs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { sourceId?: unknown; enabled?: unknown } | null;
  const sourceId = body?.sourceId;
  const enabled = body?.enabled;
  if (!Number.isInteger(sourceId) || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "Нужны sourceId (число) и enabled (true/false)" }, { status: 400 });
  }

  const ok = await withViewerWrite((db, userId) => setSourceEnabled(db, userId, sourceId as number, enabled));
  if (ok === null) return NextResponse.json({ error: "Попробуйте через минуту" }, { status: 429 });
  if (!ok) return NextResponse.json({ error: "Издание не найдено" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
