import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pool } from "../lib/db.js";
import type { PreviousFetch } from "./fetchPolicy.js";

export type FeedResponse = { xml: string; status: number; contentType: string | null; age: string | null };
export type FeedSample = { title?: string; link?: string; rawDate?: string; date?: string; decision: string };
export type SourceDiagnostic = PreviousFetch & {
  workflowRunId?: string;
  sourceId: number; name: string; rssUrl: string; durationMs: number;
  status: number | null; contentType: string | null; age: string | null; fingerprint: string | null;
  items: number; freshItems: number; eligible: number; known: number; attempted: number;
  saved: number; recovered: number; deferred: number; summaryErrors: number; pageErrors: number;
  windowHours: number; outcomes: Record<string, number>; snapshot?: FeedSample[];
};

export function diagnosticFor(source: { id: number; name: string; rss_url: string }): SourceDiagnostic {
  return { workflowRunId: process.env.GITHUB_RUN_ID, sourceId: source.id, name: source.name, rssUrl: source.rss_url, at: new Date().toISOString(),
    durationMs: 0, status: null, contentType: null, age: null, fingerprint: null, newestItemAt: null,
    feedError: null, retryNeeded: false, items: 0, freshItems: 0, eligible: 0, known: 0, attempted: 0,
    saved: 0, recovered: 0, deferred: 0, summaryErrors: 0, pageErrors: 0, windowHours: 24, outcomes: {} };
}
export function outcome(d: SourceDiagnostic, reason: string): void {
  d.outcomes[reason] = (d.outcomes[reason] ?? 0) + 1;
}
export function fingerprint(xml: string): string { return createHash("sha256").update(xml).digest("hex"); }

export async function initDiagnostics(): Promise<Map<number, PreviousFetch>> {
  const { rows: [tables] } = await pool.query<{ runs: string | null; volumes: string | null }>(
    "SELECT to_regclass('source_fetch_diagnostics')::text AS runs, to_regclass('source_volume_daily')::text AS volumes"
  );
  if (!tables.runs || !tables.volumes) await pool.query(readFileSync(new URL("../../db/fetch-diagnostics.sql", import.meta.url), "utf8"));
  const { rows } = await pool.query<{ source_id: number; data: SourceDiagnostic }>(
    `SELECT DISTINCT ON (source_id) source_id, data FROM source_fetch_diagnostics
     WHERE observed_at > now() - interval '56 days' ORDER BY source_id, observed_at DESC`
  );
  return new Map(rows.map(r => [r.source_id, r.data]));
}

export async function persistDiagnostics(runId: string, diagnostics: SourceDiagnostic[], retentionDays = 7): Promise<void> {
  if (diagnostics.length) await pool.query(
    `INSERT INTO source_fetch_diagnostics (run_id, source_id, observed_at, data)
     SELECT $1::uuid, (d->>'sourceId')::int, (d->>'at')::timestamptz, d
     FROM jsonb_array_elements($2::jsonb) d ON CONFLICT DO NOTHING`,
    [runId, JSON.stringify(diagnostics)]
  );
  // Только полностью доступные дни: самый старый частичный день retention
  // не перезаписываем нулями. Сегодня обновляется до завершения дня.
  await pool.query(
    `INSERT INTO source_volume_daily (day, name, articles)
     SELECT days.day::date, s.name, count(a.id)::int
     FROM (SELECT DISTINCT name FROM sources) s
     CROSS JOIN generate_series(
       (now() AT TIME ZONE 'Europe/Moscow')::date - $1::int,
       (now() AT TIME ZONE 'Europe/Moscow')::date, interval '1 day') AS days(day)
     LEFT JOIN (articles a JOIN sources src ON src.id = a.source_id)
       ON src.name = s.name AND a.visible_at IS NOT NULL
       AND a.created_at >= days.day::date::timestamp AT TIME ZONE 'Europe/Moscow'
       AND a.created_at < (days.day::date + 1)::timestamp AT TIME ZONE 'Europe/Moscow'
     GROUP BY days.day, s.name
     ON CONFLICT (day, name) DO UPDATE SET articles = EXCLUDED.articles`,
    [Math.max(0, Math.min(6, Math.floor(retentionDays) - 1))]
  );
  await pool.query("DELETE FROM source_fetch_diagnostics WHERE observed_at < now() - interval '56 days'");
  await pool.query("DELETE FROM source_volume_daily WHERE day < (now() AT TIME ZONE 'Europe/Moscow')::date - 56");
}
