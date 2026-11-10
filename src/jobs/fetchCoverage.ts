import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../lib/db.js";

export type ObservedLink = { link: string; title: string; publishedAt: string | null; decision: string };

export async function initCoverage(): Promise<void> {
  await pool.query(readFileSync(new URL("../../db/fetch-coverage.sql", import.meta.url), "utf8"));
  await pool.query("DELETE FROM fetch_link_coverage WHERE last_seen_at < now() - interval '56 days'");
}

// Повторный RSS не сбрасывает возраст ожидания и причину предыдущей неудачи.
export async function observeLinks(sourceId: number, observations: ObservedLink[]): Promise<void> {
  if (!observations.length) return;
  const unique = [...new Map(observations.map(row => [row.link, row])).values()];
  await pool.query(
    `INSERT INTO fetch_link_coverage (source_id, link, title, published_at, decision)
     SELECT $1, x.link, x.title, x."publishedAt", x.decision
     FROM jsonb_to_recordset($2::jsonb) AS x(link text, title text, "publishedAt" timestamptz, decision text)
     ON CONFLICT (source_id, link) DO UPDATE SET
       title = EXCLUDED.title, published_at = EXCLUDED.published_at, last_seen_at = now(),
       decision = CASE WHEN EXCLUDED.decision = 'eligible'
         AND fetch_link_coverage.decision IN ('attempted', 'summary_error', 'recovery_limit', 'saved', 'summary_quality', 'no_text')
         THEN fetch_link_coverage.decision ELSE EXCLUDED.decision END`,
    [sourceId, JSON.stringify(unique)]
  );
}

// Один завершённый проход фида учитывается не больше одного раза.
// Решение known не подменяет результат: публикацию и исключение сверяем с БД.
export async function completeCoverage(sourceId: number, runId: string, observations: ObservedLink[], completed = true): Promise<void> {
  const unique = [...new Map(observations.map(row => [row.link, row])).values()];
  await pool.query(
    `UPDATE fetch_link_coverage c SET
       completed_checks = c.completed_checks + CASE WHEN $4 THEN 1 ELSE 0 END,
       last_completed_run = CASE WHEN $4 THEN $2::uuid ELSE c.last_completed_run END,
       decision = COALESCE((
         SELECT x.decision FROM jsonb_to_recordset($3::jsonb) AS x(link text, decision text)
         WHERE x.link = c.link AND x.decision NOT IN ('known', 'eligible')
       ), c.decision)
     WHERE c.source_id = $1 AND c.last_completed_run IS DISTINCT FROM $2::uuid
       AND c.last_seen_at > now() - interval '72 hours'`,
    [sourceId, runId, JSON.stringify(unique), completed]
  );
}

export type CoverageRow = {
  name: string; link: string; title: string; decision: string;
  first_seen_at: Date; published_at: Date | null; completed_checks: number;
  article_id: number | null; published: boolean; skipped_reason: string | null;
};

const EXCLUSIONS = new Set(["advertising", "excluded_format", "excluded_category", "sport", "shopping"]);
export function coverageState(row: CoverageRow, now: number): string {
  if (row.published) return "published";
  if (row.skipped_reason === "summary_quality" || row.decision === "summary_quality") return "quality_failed";
  const reason = row.skipped_reason ?? row.decision;
  if (EXCLUSIONS.has(reason)) return "excluded";
  if (reason === "no_text") return "no_text";
  if (reason === "invalid_date" || reason === "missing_title_link" || reason === "invalid_link") return "invalid_metadata";
  const overdue = now - new Date(row.first_seen_at).getTime() >= 2 * 3_600_000 && row.completed_checks >= 2;
  if (row.article_id !== null) return overdue ? "stuck" : "processing";
  return overdue ? "missing" : "pending";
}

export async function coverageReport() {
  const { rows: [table] } = await pool.query("SELECT to_regclass('fetch_link_coverage') AS name");
  if (!table.name) return { available: false, counts: {}, examples: [] };
  // Ограничение 72 часами защищает от ложных потерь после штатной очистки
  // семидневных статей. В БД сохраняется более длинная история наблюдений.
  const { rows } = await pool.query<CoverageRow>(
    `SELECT s.name, c.*, a.id AS article_id, k.reason AS skipped_reason,
       COALESCE(a.visible_at IS NOT NULL AND EXISTS (
         SELECT 1 FROM articles member WHERE member.cluster_id = a.cluster_id
           AND member.visible_at IS NOT NULL AND member.ai_summary IS NOT NULL
       ), false) AS published
     FROM fetch_link_coverage c JOIN sources s ON s.id = c.source_id
     LEFT JOIN articles a ON a.link = c.link
     LEFT JOIN skipped_links k ON k.link = c.link
     WHERE c.last_seen_at > now() - interval '72 hours'
       AND (c.published_at IS NULL OR c.published_at > now() - interval '72 hours')
     ORDER BY s.name, c.link, c.completed_checks DESC, c.first_seen_at`
  );
  const counts: Record<string, number> = {};
  const examples: { name: string; link: string; title: string; state: string; decision: string; waitingMinutes: number; completedChecks: number }[] = [];
  const seen = new Set<string>();
  const now = Date.now();
  for (const row of rows) {
    // Одна ссылка может присутствовать в нескольких разделах издания.
    const key = row.name + "\n" + row.link;
    if (seen.has(key)) continue;
    seen.add(key);
    const state = coverageState(row, now);
    counts[state] = (counts[state] ?? 0) + 1;
    const waitingMinutes = Math.floor((now - new Date(row.first_seen_at).getTime()) / 60_000);
    const longWait = waitingMinutes >= 120 && (state === "pending" || state === "processing");
    if (examples.length < 20 && (longWait || ["missing", "stuck", "no_text", "invalid_metadata"].includes(state)))
      examples.push({ name: row.name, link: row.link, title: row.title, state,
        decision: row.skipped_reason ?? row.decision, waitingMinutes, completedChecks: row.completed_checks });
  }
  return { available: true, counts, examples };
}

// Проверочный режим только читает данные, Telegram не вызывается.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  coverageReport().then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(err => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
}
