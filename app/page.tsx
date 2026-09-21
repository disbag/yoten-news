import Link from "next/link";
import { getFeed } from "../src/lib/feed";
import { getSessionUserId } from "../src/lib/session";
import { CATEGORIES } from "../src/config/categories";
import FeedList from "./components/FeedList";
import AuthWidget from "./components/AuthWidget";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

export default async function HomePage({
  searchParams,
}: {
  searchParams: { category?: string; unread?: string };
}) {
  const activeCategory = CATEGORIES.find((c) => c.id === searchParams.category);
  const unreadOnly = searchParams.unread === "1";
  const userId = await getSessionUserId();
  // На единицу больше лимита — чтобы понять, есть ли ещё карточки для кнопки
  // "Показать ещё" (см. FeedList.tsx), без отдельного count-запроса.
  const rows = await getFeed({ category: activeCategory?.id, limit: PAGE_SIZE + 1, userId, unreadOnly });
  const hasMore = rows.length > PAGE_SIZE;
  const feed = rows.slice(0, PAGE_SIZE);

  const categoryQuery = activeCategory ? `category=${activeCategory.id}` : "";

  return (
    <main>
      <header>
        {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG, next/image здесь избыточен */}
        <img src="/logo.svg" alt="Yoten" className="logo" />
        {/* Иконка входа/выхода в углу вровень с надписью "Yōten" (см.
            auth-corner) — для гостя открывает попап с кнопками входа/
            регистрации (см. AuthWidget), а не занимает место в самой шапке. */}
        <div className="auth-corner">
          <AuthWidget />
        </div>
      </header>

      <div className="filters">
        <div className="filters-list">
          <Link href="/" className={!activeCategory ? "active" : undefined}>
            Все
          </Link>
          {CATEGORIES.map((c) => (
            <Link
              key={c.id}
              href={`/?category=${c.id}`}
              className={activeCategory?.id === c.id ? "active" : undefined}
            >
              {c.label}
            </Link>
          ))}
        </div>
        {userId && (
          <Link
            href={unreadOnly ? `/?${categoryQuery}` : `/?${categoryQuery}${categoryQuery ? "&" : ""}unread=1`}
            className={unreadOnly ? "unread-toggle active" : "unread-toggle"}
          >
            {unreadOnly ? "Показать все" : "Только непрочитанные"}
          </Link>
        )}
      </div>

      {/* key заставляет React пересоздать компонент (и его внутренний стейт
          items/hasMore) при смене категории — иначе при клике по фильтру
          React переиспользует тот же экземпляр FeedList, initialItems в
          пропсах меняется, а useState(initialItems) это игнорирует (стейт
          инициализируется только при монтировании), и лента визуально не
          обновляется без полной перезагрузки страницы. */}
      <FeedList
        key={`${activeCategory?.id ?? "all"}:${unreadOnly}`}
        initialItems={feed}
        initialHasMore={hasMore}
        category={activeCategory?.id}
        unreadOnly={unreadOnly}
      />
    </main>
  );
}
