// Отображаемые названия категорий — id должен совпадать со значением,
// которое сохраняется в articles.category (см. CATEGORIES/ALL_TAGS в
// src/lib/prompt.ts, там же модель размечает тему при саммаризации).
// Список используется и для фильтра в шапке (app/page.tsx), и для тега
// рядом с датой на карточке (app/components/FeedCard.tsx).
// "sport" и "shopping" намеренно не показаны здесь: спортивные новости и
// реклама не попадают в ленту вообще (см. обработку этих тегов в
// fetchAndProcess.ts и backfillCategories.ts) — модель всё ещё распознаёт эти
// темы, чтобы можно было отличить и отфильтровать их от реального "other".
// "art" подписан "Культура": тег остался со времён рубрики "Искусство", из
// которой выделили кино, музыку и дизайн (см. коммент у CATEGORIES в
// src/lib/prompt.ts).
export const CATEGORIES = [
  { id: "technology", label: "Технологии" },
  { id: "science", label: "Наука" },
  { id: "art", label: "Культура" },
  { id: "film", label: "Кино и сериалы" },
  { id: "music", label: "Музыка" },
  { id: "design", label: "Дизайн" },
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
