import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pool } from "../lib/db.js";
import { SOURCES } from "../config/sources.js";

// Ежедневный отчёт о состоянии ленты (DIS-81): работает ли сбор, отвечает ли
// сайт и какие издания сломались. В отчёт попадают только проблемы — издания,
// у которых всё в порядке, не перечисляются.
//
// Данные: прогоны сбора за сутки и их логи (GitHub Actions, через gh) и
// статьи в базе за сутки против предыдущих шести дней. Отправка — ботом
// Telegram (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID); без них или с --dry отчёт
// только печатается.
const exec = promisify(execFile);
const REPO = process.env.GITHUB_REPOSITORY ?? "disbag/yoten-news";
const WORKFLOW = "fetch-cron.yml";
// Не RP_ORIGIN: локально там localhost, а проверять нужно рабочий сайт.
const SITE = process.env.HEALTH_SITE_URL ?? "https://yoten-news.vercel.app";
const DAY_MS = 24 * 60 * 60 * 1000;
const dry = process.argv.includes("--dry");

type Run = { databaseId: number; conclusion: string | null; status: string; createdAt: string; updatedAt: string };

async function gh(args: string[]): Promise<string> {
  const { stdout } = await exec("gh", args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

// Строки лога одного прогона без служебных префиксов GitHub (джоба, шаг, время).
async function runLog(id: number): Promise<string[]> {
  const text = await gh(["run", "view", String(id), "--repo", REPO, "--log"]).catch(() => "");
  return text.split("\n").map((line) => line.split("\t").slice(2).join("\t").replace(/^\S+Z /, ""));
}

type SourceLog = { runs: number; rssErrors: number; lastRssError?: string; pageErrors: number };

async function collectRuns() {
  const since = Date.now() - DAY_MS;
  const runs: Run[] = JSON.parse(
    await gh(["run", "list", "--repo", REPO, "--workflow", WORKFLOW, "--limit", "100", "--json", "databaseId,conclusion,status,createdAt,updatedAt"])
  );
  const recent = runs.filter((r) => Date.parse(r.createdAt) > since);
  const done = recent.filter((r) => r.status === "completed");
  const logs = await mapLimit(done, 8, (r) => runLog(r.databaseId));

  const sources = new Map<string, SourceLog>();
  let groq = 0;
  let stops = 0;
  let modelDown = 0;
  let threadErrors = 0;
  for (const lines of logs) {
    let source = "";
    const seen = new Set<string>();
    for (const line of lines) {
      if (line.startsWith("→ ")) {
        source = line.slice(2).replace(/ \(.*\)$/, "");
        const s = sources.get(source) ?? { runs: 0, rssErrors: 0, pageErrors: 0 };
        if (!seen.has(source)) s.runs++;
        seen.add(source);
        sources.set(source, s);
        continue;
      }
      const s = sources.get(source);
      if (s && line.includes("не удалось получить RSS")) {
        s.rssErrors++;
        s.lastRssError = line.replace(/^.*не удалось получить RSS:\s*/, "").trim();
      }
      if (s && line.includes("страница статьи не открылась")) s.pageErrors++;
      if (line.includes("переключаюсь на Groq")) groq++;
      if (line.includes("Останавливаю прогон")) stops++;
      if (/модель .* недоступна/.test(line)) modelDown++;
      if (line.includes("Треды: ошибка раскладки")) threadErrors++;
    }
  }
  const last = done.map((r) => Date.parse(r.updatedAt)).sort((a, b) => b - a)[0];
  const durations = done.map((r) => (Date.parse(r.updatedAt) - Date.parse(r.createdAt)) / 60_000);
  return {
    total: recent.length,
    failed: done.filter((r) => r.conclusion !== "success").length,
    lastFinishedMinutesAgo: last ? Math.round((Date.now() - last) / 60_000) : null,
    longestMinutes: durations.length ? Math.round(Math.max(...durations)) : 0,
    sources,
    groq,
    stops,
    modelDown,
    threadErrors,
  };
}

// Статьи по изданиям: последние сутки против среднего за предыдущие 6 дней.
// Сигналы — то, что ломалось на деле: пропали статьи (фид сломан или пуст),
// обложки, галереи (Dezeen сменил адрес картинок 21 октября), продолжение
// «Читать» (InsideEVs закрылся проверкой на бота 23 октября).
async function collectArticles() {
  const { rows } = await pool.query<{
    name: string;
    n_day: number;
    n_week: number;
    img_day: number;
    img_week: number;
    gal_day: number;
    gal_week: number;
    more_day: number;
    more_week: number;
  }>(
    `SELECT s.name,
       count(*) FILTER (WHERE a.created_at > now() - interval '1 day')::int AS n_day,
       count(*) FILTER (WHERE a.created_at <= now() - interval '1 day')::int AS n_week,
       count(*) FILTER (WHERE a.created_at > now() - interval '1 day' AND a.image_url IS NOT NULL)::int AS img_day,
       count(*) FILTER (WHERE a.created_at <= now() - interval '1 day' AND a.image_url IS NOT NULL)::int AS img_week,
       count(*) FILTER (WHERE a.created_at > now() - interval '1 day' AND cardinality(a.image_urls) > 1)::int AS gal_day,
       count(*) FILTER (WHERE a.created_at <= now() - interval '1 day' AND cardinality(a.image_urls) > 1)::int AS gal_week,
       count(*) FILTER (WHERE a.created_at > now() - interval '1 day' AND a.ai_summary_more IS NOT NULL)::int AS more_day,
       count(*) FILTER (WHERE a.created_at <= now() - interval '1 day' AND a.ai_summary_more IS NOT NULL)::int AS more_week
     FROM sources s
     LEFT JOIN articles a ON a.source_id = s.id AND a.created_at > now() - interval '7 days' AND a.visible_at IS NOT NULL
     GROUP BY s.name`
  );
  const { rows: totals } = await pool.query<{ day: number; week: number; oldest: Date }>(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS day,
            count(*) FILTER (WHERE created_at <= now() - interval '1 day')::int AS week,
            min(created_at) AS oldest
     FROM articles WHERE created_at > now() - interval '7 days' AND visible_at IS NOT NULL`
  );
  return { rows, total: totals[0] };
}

async function checkSite(): Promise<string | null> {
  for (const path of ["/", "/api/feed?limit=1"]) {
    try {
      const res = await fetch(`${SITE}${path}`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return `${path} отвечает ${res.status}`;
    } catch (err) {
      return `${path} не отвечает (${(err as Error).message})`;
    }
  }
  return null;
}

const share = (part: number, whole: number) => (whole ? part / whole : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;
// 1 прогон, 2 прогона, 5 прогонов.
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${word}`;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function main() {
  const [runs, articles, siteProblem] = await Promise.all([collectRuns(), collectArticles(), checkSite()]);
  const sourceProblems: string[] = [];
  const byName = new Map(articles.rows.map((r) => [r.name, r]));
  const empty = { n_day: 0, n_week: 0, img_day: 0, img_week: 0, gal_day: 0, gal_week: 0, more_day: 0, more_week: 0 };

  // Дней в базовом периоде — у изданий, добавленных на неделе, их меньше.
  const baseDays = Math.max(1, Math.min(6, (Date.now() - new Date(articles.total.oldest).getTime()) / DAY_MS - 1));
  // По изданиям из конфига — и тем, у кого статей в базе нет вовсе.
  for (const name of [...new Set(SOURCES.map((s) => s.name))]) {
    const r = { name, ...(byName.get(name) ?? empty) };
    const perDay = r.n_week / baseDays;
    const log = runs.sources.get(r.name);
    const issues: string[] = [];
    if (log && log.rssErrors > 0 && log.rssErrors >= log.runs / 2) {
      issues.push(`RSS не открывается: ${esc(log.lastRssError ?? "ошибка")} в ${log.rssErrors} из ${log.runs} прогонов`);
    } else if (r.n_day === 0 && perDay >= 2) {
      issues.push(`ни одной статьи за сутки (обычно ~${Math.round(perDay)} в день)`);
    } else if (r.n_day === 0 && r.n_week === 0) {
      // Так выглядело издание, фид которого с GitHub отдаёт не то, что
      // локально (Cool Hunting, 26 октября): ни ошибок, ни статей.
      issues.push("ни одной статьи за неделю");
    }
    if (r.n_day >= 3) {
      const checks: [string, number, number, number][] = [
        ["обложки", r.img_day, r.img_week, 0.5],
        ["галереи", r.gal_day, r.gal_week, 0.3],
        ["продолжение «Читать»", r.more_day, r.more_week, 0.5],
      ];
      for (const [what, day, week, min] of checks) {
        const before = share(week, r.n_week);
        if (before >= min && day === 0) issues.push(`пропали ${what}: 0 из ${r.n_day} за сутки (было ${pct(before)})`);
      }
    }
    if (issues.length) sourceProblems.push(`• <b>${esc(r.name)}</b> — ${issues.join("; ")}`);
  }

  const problems: string[] = [];
  if (runs.total === 0) problems.push("Сбор не запускался больше суток");
  else if (runs.lastFinishedMinutesAgo !== null && runs.lastFinishedMinutesAgo > 120)
    problems.push(`Последний прогон сбора закончился ${Math.round(runs.lastFinishedMinutesAgo / 60)} ч назад`);
  if (runs.failed) problems.push(`Прогонов с ошибкой: ${runs.failed} из ${runs.total}`);
  if (runs.stops) problems.push(`Прогон останавливался из-за лимитов моделей: ${plural(runs.stops, "раз", "раза", "раз")}`);
  if (runs.threadErrors) problems.push(`Ошибки раскладки по тредам: ${runs.threadErrors}`);
  const usualPerDay = articles.total.week / baseDays;
  if (usualPerDay > 0 && articles.total.day < usualPerDay * 0.5)
    problems.push(`Статей за сутки ${articles.total.day} — вдвое меньше обычного (~${Math.round(usualPerDay)})`);
  if (siteProblem) problems.push(`Сайт: ${esc(siteProblem)}`);

  const date = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
  const lines = [`<b>Yoten — ${date}</b>`];
  const summary = `${plural(runs.total, "прогон", "прогона", "прогонов")} сбора, статей за сутки ${articles.total.day} (обычно ~${Math.round(usualPerDay)})`;
  if (!problems.length && !sourceProblems.length) {
    lines.push(`✅ Всё работает: ${summary}, сайт отвечает.`);
  } else {
    lines.push(problems.length ? `⚠️ ${summary}` : `✅ Сбор и сайт в порядке: ${summary}.`);
    for (const p of problems) lines.push(`• ${p}`);
    if (sourceProblems.length) lines.push("", "<b>Издания с проблемами:</b>", ...sourceProblems);
  }
  const notes: string[] = [];
  if (runs.groq) notes.push(`Groq подменял Gemini ${plural(runs.groq, "раз", "раза", "раз")}`);
  if (runs.modelDown) notes.push(`модели Gemini были недоступны ${plural(runs.modelDown, "раз", "раза", "раз")}, сбор переключался на другую`);
  if (notes.length) lines.push("", `ℹ️ ${notes.join("; ")}.`);
  const text = lines.join("\n");

  console.log(text);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (dry || !token || !chat) {
    if (!dry) console.log("\n(TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы — отчёт не отправлен)");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram ответил ${res.status}: ${await res.text()}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
