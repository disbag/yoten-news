import { NextRequest, NextResponse } from "next/server";
import { getFeed } from "../../../src/lib/feed";

// Отдаёт на одну карточку больше запрошенного limit, чтобы понять, есть ли
// ещё данные, без отдельного count-запроса — hasMore = смогли получить
// limit+1-ю карточку. Используется и первой загрузкой страницы (см.
// app/page.tsx), и кнопкой "Показать ещё" (см. app/components/FeedList.tsx).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") ?? undefined;
  const limit = Number(searchParams.get("limit") ?? 30);
  const offset = Number(searchParams.get("offset") ?? 0);

  const rows = await getFeed({ category, limit: limit + 1, offset });
  const hasMore = rows.length > limit;

  return NextResponse.json({ items: rows.slice(0, limit), hasMore });
}
