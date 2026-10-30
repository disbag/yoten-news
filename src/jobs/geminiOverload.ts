const OVERLOAD_PER_HOUR = 5;
const HOUR = 60 * 60 * 1000;

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${word}`;
}

export type PostponedArticle = { at: number; article: string };

export function geminiOverload(failures: number[], postponed: PostponedArticle[]): string | null {
  const byHour = new Map<number, number>();
  for (const at of failures) {
    const hour = Math.floor(at / HOUR);
    byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
  }
  const busy = [...byHour].filter(([, n]) => n >= OVERLOAD_PER_HOUR).map(([h]) => h).sort((a, b) => a - b);
  if (!busy.length) return null;

  // Соседние часы — один промежуток: «17:00–19:00».
  const ranges: [number, number][] = [];
  for (const h of busy) {
    const last = ranges[ranges.length - 1];
    if (last && h === last[1] + 1) last[1] = h;
    else ranges.push([h, h]);
  }
  const time = (hour: number) =>
    new Date(hour * HOUR).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  const when = ranges.map(([a, b]) => `${time(a)}–${time(b + 1)}`).join(", ");
  const count = busy.reduce((sum, h) => sum + byHour.get(h)!, 0);
  const busySet = new Set(busy);
  const postponedArticles = new Set(
    postponed.filter(({ at }) => busySet.has(Math.floor(at / HOUR))).map(({ article }) => article)
  ).size;
  const outcome = postponedArticles
    ? `${plural(postponedArticles, "статья отложена", "статьи отложены", "статей отложено")} до следующего прогона`
    : "статьи не потеряны";
  return `перегрузка Gemini ${when} МСК (${plural(count, "сбой", "сбоя", "сбоев")}): сбор переключался между моделями, ${outcome}`;
}
