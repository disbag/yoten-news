// Адрес страницы издания (DIS-80): /source/<slug>, slug — из названия
// ("The NY Times" → "the-ny-times", "Condé Nast Traveler" →
// "conde-nast-traveler"). Без зависимостей — нужен и в карточке на клиенте.
export function sourceSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sourcePath(name: string): string {
  return `/source/${sourceSlug(name)}`;
}

