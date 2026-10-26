import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../src/lib/db";
import { getViewerId } from "../../../src/lib/viewer";

const MAX_IDS = 100;

// Отметка прочитанного — fire-and-forget (см. FeedCard.tsx): ошибка не
// показывается, в худшем случае карточка снова придёт непрочитанной.
export async function POST(request: NextRequest) {
  // clusterIds — все карточки треда одним запросом. clusterId — прежний
  // формат: его шлют вкладки, открытые до обновления.
  const body = (await request.json().catch(() => null)) as { clusterIds?: unknown; clusterId?: unknown } | null;
  const ids = body?.clusterIds ?? (body?.clusterId !== undefined ? [body.clusterId] : undefined);
  const valid = (id: unknown) => Number.isInteger(id) && (id as number) > 0 && (id as number) <= 2 ** 31 - 1;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || !ids.every(valid)) {
    return NextResponse.json({ error: `clusterIds — от 1 до ${MAX_IDS} номеров карточек` }, { status: 400 });
  }

  // Первая отметка заводит строку браузера (см. src/lib/viewer.ts).
  const userId = await getViewerId({ create: true });
  if (!userId) return NextResponse.json({ ok: false }, { status: 429 });

  // Только существующие карточки: иначе бот мог бы набить отметок сколько
  // угодно. Так у браузера их не больше, чем карточек в базе.
  await pool.query(
    `INSERT INTO article_reads (user_id, cluster_id)
     SELECT $1, c FROM unnest($2::int[]) c WHERE EXISTS (SELECT 1 FROM articles a WHERE a.cluster_id = c)
     ON CONFLICT DO NOTHING`,
    [userId, ids]
  );
  return NextResponse.json({ ok: true });
}
