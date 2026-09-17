// Отображаемые названия категорий — id должен совпадать со значением,
// которое сохраняется в articles.category (см. CATEGORIES/ALL_TAGS в
// src/lib/prompt.ts, там же модель размечает тему при саммаризации).
// Список используется и для фильтра в шапке (app/page.tsx), и для тега
// рядом с датой на карточке (app/components/FeedCard.tsx).
// "sport" намеренно не показан здесь: спортивные новости не попадают в
// ленту вообще (см. PROMO_TITLE_PATTERN-соседнюю логику в
// fetchAndProcess.ts и обработку "sport" в backfillCategories.ts) — модель
// всё ещё распознаёт эту тему, чтобы можно было отличить и отфильтровать
// спорт от реального "other".
export const CATEGORIES = [
  { id: "technology", label: "Технологии" },
  { id: "art", label: "Искусство" },
  { id: "games", label: "Игры" },
  { id: "auto", label: "Авто" },
  { id: "travel", label: "Путешествия" },
  { id: "economy", label: "Экономика" },
  { id: "politics", label: "Политика" },
  { id: "incidents", label: "Происшествия" },
  { id: "health", label: "Здоровье" },
  { id: "other", label: "Другое" },
];

// Статья может относиться сразу к двум темам (см. CATEGORY_INSTRUCTIONS в
// src/lib/prompt.ts) — собираем оба лейбла в одну строку для тега на
// карточке (см. FeedCard.tsx), например "Технологии, Авто".
export function categoryLabels(ids: string[] | null): string | null {
  if (!ids || !ids.length) return null;
  const labels = ids
    .map((id) => CATEGORIES.find((c) => c.id === id)?.label)
    .filter((label): label is string => Boolean(label));
  return labels.length ? labels.join(", ") : null;
}
