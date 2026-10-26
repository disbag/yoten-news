import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../src/lib/db";
import { getSessionUserId } from "../../../src/lib/session";

const MAX_IDS = 100;

// Не залогинен — тихо игнорируем, а не 401: карточка на клиенте не обязана
// знать статус авторизации, просто пытается отметить прочитанное при
// открытии (см. FeedCard.tsx) и не показывает никакой ошибки, если это не
// сработало — фича не критична для базовой работы ленты.
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ ok: false });

  // clusterIds — все карточки треда одним запросом (раньше — запрос на
  // карточку, до 36 у длинного треда). Битое тело или не целые числа давали
  // 500 (ошибка JSON или Postgres), а не ответ «неверный запрос».
  // clusterId — прежний формат: его шлют вкладки, открытые до обновления.
  const body = (await request.json().catch(() => null)) as { clusterIds?: unknown; clusterId?: unknown } | null;
  const ids = body?.clusterIds ?? (body?.clusterId !== undefined ? [body.clusterId] : undefined);
  const valid = (id: unknown) => Number.isInteger(id) && (id as number) > 0 && (id as number) <= 2 ** 31 - 1;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || !ids.every(valid)) {
    return NextResponse.json({ error: `clusterIds — от 1 до ${MAX_IDS} номеров карточек` }, { status: 400 });
  }

  await pool.query(
    "INSERT INTO article_reads (user_id, cluster_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING",
    [userId, ids]
  );
  return NextResponse.json({ ok: true });
}
