// Место в ленте, на котором пользователь остановился (DIS-25), — номер
// карточки в cookie, своей на каждую рубрику. Именно cookie, а не только
// localStorage: по ней сервер сразу отдаёт ленту с нужной карточки (см.
// app/page.tsx), без перерисовки после загрузки. Пишет её FeedList.tsx.
export function positionCookieName(category?: string): string {
  return `yoten_pos_${category ?? "all"}`;
}

// Сколько карточек приходит за раз — и в первой отрисовке, и при подгрузке.
export const FEED_PAGE_SIZE = 10;
