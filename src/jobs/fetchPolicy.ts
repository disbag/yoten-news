export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

export function normalizeFeedDate(raw: string | undefined, parsed: string | undefined, offset?: string): string | undefined {
  // rss-parser уже вычислил isoDate в часовом поясе процесса. Для исходной
  // ISO-даты без зоны исправляем именно исходную строку, до фильтра по возрасту.
  const unzoned = raw?.trim().match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/);
  const value = unzoned && offset ? `${raw!.trim()}${offset}` : parsed;
  const at = value ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
}

export type PreviousFetch = { at: string; newestItemAt: string | null; retryNeeded: boolean; feedError: string | null };
export function fetchWindowHours(previous: PreviousFetch | undefined, now: number, manualDays: number): number {
  if (manualDays > 0) return 24 * (1 + manualDays);
  if (!previous) return 24;
  const delayed = previous.newestItemAt && now - Date.parse(previous.newestItemAt) > DAY_MS;
  const gap = now - Date.parse(previous.at) > HOUR_MS;
  return previous.retryNeeded || previous.feedError || delayed || gap ? 72 : 24;
}

export function inFetchWindow(isoDate: string | undefined, now: number, hours: number): boolean {
  const at = isoDate ? Date.parse(isoDate) : NaN;
  return Number.isFinite(at) && at >= now - hours * HOUR_MS && at <= now + DAY_MS;
}

// Свежие статьи обрабатываются раньше догрузки независимо от порядка RSS.
export function freshFirst<T extends { isoDate?: string }>(items: T[], now: number): T[] {
  return [...items].sort((a, b) => Number(inFetchWindow(b.isoDate, now, 24)) - Number(inFetchWindow(a.isoDate, now, 24)));
}

export function claimRecoverySlot(source: { count: number }, run: { count: number }): boolean {
  if (source.count <= 0 || run.count <= 0) return false;
  source.count--;
  run.count--;
  return true;
}
