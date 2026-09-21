import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../src/lib/db";
import { getSessionUserId } from "../../../src/lib/session";

// Не залогинен — тихо игнорируем, а не 401: карточка на клиенте не обязана
// знать статус авторизации, просто пытается отметить прочитанное при
// открытии (см. FeedCard.tsx) и не показывает никакой ошибки, если это не
// сработало — фича не критична для базовой работы ленты.
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ ok: false });

  const { clusterId } = (await request.json()) as { clusterId?: number };
  if (!clusterId) return NextResponse.json({ error: "clusterId обязателен" }, { status: 400 });

  await pool.query(
    "INSERT INTO article_reads (user_id, cluster_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [userId, clusterId]
  );
  return NextResponse.json({ ok: true });
}
