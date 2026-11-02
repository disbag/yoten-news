import type { SourceDiagnostic } from "./sourceDiagnostics.js";

export type VolumeDay = { day: string; name: string; articles: number };
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const weekend = (day: string) => [0, 6].includes(weekday(day));

// Сначала тот же день недели. До накопления двух недель — сопоставимые
// будни/выходные. При малой выборке не изображаем статистическую уверенность.
export function volumeBaseline(history: VolumeDay[], name: string, targetDay: string): number | null {
  const earlier = history.filter(r => r.name === name && r.day < targetDay);
  const sameDay = earlier.filter(r => weekday(r.day) === weekday(targetDay));
  const comparable = earlier.filter(r => weekend(r.day) === weekend(targetDay));
  const sample = sameDay.length >= 2 ? sameDay : comparable.length >= 3 ? comparable : [];
  return sample.length ? sample.reduce((sum, r) => sum + r.articles, 0) / sample.length : null;
}

export function sourceHealth(records: SourceDiagnostic[], now: number): { problems: string[]; notes: string[] } {
  const problems: string[] = [], notes: string[] = [];
  const feeds = new Map<number, SourceDiagnostic[]>();
  for (const d of records) feeds.set(d.sourceId, [...(feeds.get(d.sourceId) ?? []), d]);
  for (const rows of feeds.values()) {
    rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const last = rows.at(-1)!;
    const recent = rows.slice(-2);
    const label = feeds.size > 1 ? ` (${new URL(last.rssUrl).pathname})` : "";
    if (last.feedError) {
      if (recent.length === 2 && recent.every(r => r.feedError)) problems.push(`RSS недоступен${label}: ${last.feedError}`);
      else notes.push(`разовая ошибка RSS${label}: ${last.feedError}`);
      continue;
    }
    if (recent.length === 2 && recent.every(r => r.items === 0)) {
      problems.push(`RSS возвращает пустую ленту${label}`);
      continue;
    }
    if (last.outcomes.invalid_date) problems.push(`не распознаны даты у ${last.outcomes.invalid_date} элементов RSS${label}`);
    if (recent.length === 2 && recent.every(r => r.retryNeeded && r.attempted > 0 && r.saved === 0 && (r.summaryErrors > 0 || r.outcomes.interrupted))) {
      problems.push(`статьи получены, но обработка не завершилась${label}`);
    } else if (last.deferred) notes.push(`догрузку ожидают ${last.deferred} статей${label}`);
  }
  const valid = [...feeds.values()].map(rows => rows.at(-1)!).filter(r => !r.feedError);
  if (valid.length && valid.every(r => r.items > 0 && r.freshItems === 0)) {
    const newest = valid.map(r => r.newestItemAt).filter((x): x is string => !!x).sort().at(-1);
    if (newest) notes.push(`в RSS нет публикаций за последние сутки; последней ~${Math.max(0, Math.floor((now - Date.parse(newest)) / 3_600_000))} ч`);
  }
  return { problems, notes };
}

// Разрывы только между строками, поэтому <b> и HTML-сущности не режутся.
export function reportChunks(text: string, limit = 3800): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const line of text.split("\n")) {
    if (line.length > limit) throw new Error("Строка отчёта превышает лимит Telegram");
    if (chunk && chunk.length + 1 + line.length > limit) { chunks.push(chunk); chunk = ""; }
    chunk += (chunk ? "\n" : "") + line;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
