import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "../../../../src/lib/session";
import { setSourceEnabled } from "../../../../src/lib/sourcePrefs";

// Переключатель издания на странице настроек ленты (app/settings). Только
// для вошедших — настройки хранятся у пользователя в базе.
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { sourceId?: unknown; enabled?: unknown } | null;
  const sourceId = body?.sourceId;
  const enabled = body?.enabled;
  if (!Number.isInteger(sourceId) || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "Нужны sourceId (число) и enabled (true/false)" }, { status: 400 });
  }

  const ok = await setSourceEnabled(userId, sourceId as number, enabled);
  if (!ok) return NextResponse.json({ error: "Издание не найдено" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
