import { NextRequest, NextResponse } from "next/server";
import { getFeed } from "../../../src/lib/feed";
import { getSessionUserId } from "../../../src/lib/session";

// Отдаёт на одну карточку больше запрошенного limit, чтобы понять, есть ли
// ещё данные, без отдельного count-запроса — hasMore = смогли получить
// limit+1-ю карточку. Используется и первой загрузкой страницы (см.
// app/page.tsx), и кнопкой "Показать ещё" (см. app/components/FeedList.tsx).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") ?? undefined;
  const limit = Number(searchParams.get("limit") ?? 30);
  const beforePublishedAt = searchParams.get("beforePublishedAt");
  const beforeClusterId = searchParams.get("beforeClusterId");
  const before =
    beforePublishedAt && beforeClusterId
      ? { publishedAt: beforePublishedAt, clusterId: Number(beforeClusterId) }
      : undefined;
  // tab=read -> вкладка "Прочитанные", иначе (в т.ч. по умолчанию) -> "Новые"
  // (непрочитанные) — см. FeedTabs.tsx, заменили режим "показать всё".
  const readOnly = searchParams.get("tab") === "read";
  const userId = await getSessionUserId();

  const rows = await getFeed({
    category,
    limit: limit + 1,
    before,
    userId,
    unreadOnly: !readOnly,
    readOnly,
  });
  const hasMore = rows.length > limit;

  return NextResponse.json({ items: rows.slice(0, limit), hasMore });
}
