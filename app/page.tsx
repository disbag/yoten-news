import Link from "next/link";
import { getFeed } from "../src/lib/feed";
import { CATEGORIES } from "../src/config/categories";
import FeedList from "./components/FeedList";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

export default async function HomePage({
  searchParams,
}: {
  searchParams: { category?: string };
}) {
  const activeCategory = CATEGORIES.find((c) => c.id === searchParams.category);
  // На единицу больше лимита — чтобы понять, есть ли ещё карточки для кнопки
  // "Показать ещё" (см. FeedList.tsx), без отдельного count-запроса.
  const rows = await getFeed({ category: activeCategory?.id, limit: PAGE_SIZE + 1 });
  const hasMore = rows.length > PAGE_SIZE;
  const feed = rows.slice(0, PAGE_SIZE);

  return (
    <main>
      <header>
        {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG, next/image здесь избыточен */}
        <img src="/logo.svg" alt="Yoten" className="logo" />
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
      </div>

      {/* key заставляет React пересоздать компонент (и его внутренний стейт
          items/hasMore) при смене категории — иначе при клике по фильтру
          React переиспользует тот же экземпляр FeedList, initialItems в
          пропсах меняется, а useState(initialItems) это игнорирует (стейт
          инициализируется только при монтировании), и лента визуально не
          обновляется без полной перезагрузки страницы. */}
      <FeedList
        key={activeCategory?.id ?? "all"}
        initialItems={feed}
        initialHasMore={hasMore}
        category={activeCategory?.id}
      />
    </main>
  );
}
