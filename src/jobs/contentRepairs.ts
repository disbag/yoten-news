import { pool } from "../lib/db.js";

export const MAX_CONTENT_ATTEMPTS = 3; // первоначальная обработка + два повтора
export type RepairItem = { title: string; link: string; isoDate?: string; pubDate?: string;
  content?: string; contentSnippet?: string; "dc:content"?: string; "content:encoded"?: string;
  enclosure?: { url: string; type?: string; length?: number };
  "media:content"?: { $: { url: string; medium?: string } } | { $: { url: string; medium?: string } }[];
  categories?: string[] };
type RepairRow = { link: string; source_id: number; item: RepairItem; attempts: number; state: string };

// Снимок нужен для короткого RSS, из которого ссылка может исчезнуть до
// повтора. Сохраняем только контекст, не картинки/вектора/ответы модели.
export function repairSnapshot(item: RepairItem): RepairItem {
  return { title: item.title.slice(0, 400), link: item.link, isoDate: item.isoDate, pubDate: item.pubDate,
    content: item.content?.slice(0, 24_000), contentSnippet: item.contentSnippet?.slice(0, 12_000),
    "dc:content": item["dc:content"]?.slice(0, 24_000), "content:encoded": item["content:encoded"]?.slice(0, 24_000),
    enclosure: item.enclosure, "media:content": Array.isArray(item["media:content"]) ? item["media:content"].slice(0, 10) : item["media:content"],
    categories: item.categories?.slice(0, 30) };
}

export async function recordNoText(source: { id: number; name: string }, item: RepairItem): Promise<boolean> {
  const { rows: [row] } = await pool.query<RepairRow>(
    `INSERT INTO article_content_repairs (link, source_id, item) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (link) DO UPDATE SET updated_at = now(),
       state = CASE WHEN article_content_repairs.attempts >= 3 OR article_content_repairs.first_failed_at < now() - interval '24 hours'
         THEN 'exhausted' ELSE 'pending' END
     RETURNING *`, [item.link, source.id, JSON.stringify(repairSnapshot(item))]);
  const pending = row.state === "pending";
  console.log(`CONTENT_REPAIR ${JSON.stringify({ link: row.link, attempts: row.attempts, state: row.state, reason: "no_text" })}`);
  return pending;
}

export async function claimContentRepair(link: string): Promise<boolean> {
  // Считаем попытку ДО сети/модели. Даже аварийный выход не обнуляет бюджет.
  const result = await pool.query(
    `UPDATE article_content_repairs SET attempts = attempts + 1,
       next_attempt_at = now() + interval '2 hours', updated_at = now()
     WHERE link = $1 AND state = 'pending' AND attempts < 3
       AND next_attempt_at <= now() AND first_failed_at > now() - interval '24 hours'
     RETURNING link`, [link]);
  return Boolean(result.rowCount);
}

export async function resolveContentRepair(link: string): Promise<void> {
  await pool.query("UPDATE article_content_repairs SET state = 'resolved', updated_at = now() WHERE link = $1 AND state = 'pending'", [link]);
  await pool.query("DELETE FROM skipped_links WHERE link = $1 AND reason = 'no_text'", [link]);
}

export async function loadContentRepairs(sources: { id: number; name: string }[]): Promise<Map<number, RepairItem[]>> {
  const ids = sources.map(s => s.id);
  // Успешное сохранение могло завершиться до аварии между INSERT и resolve.
  await pool.query(`UPDATE article_content_repairs r SET state = 'resolved', updated_at = now()
    WHERE r.state = 'pending' AND EXISTS (
      SELECT 1 FROM articles a JOIN articles c ON c.id = a.cluster_id
      WHERE a.link = r.link AND c.ai_summary IS NOT NULL)`);
  // Также завершаем последнюю попытку, оборванную квотой или аварией.
  await pool.query(
    `UPDATE article_content_repairs SET state = 'exhausted', updated_at = now()
     WHERE source_id = ANY($1::int[]) AND state = 'pending'
       AND (attempts >= 3 OR first_failed_at <= now() - interval '24 hours')`, [ids]);
  const { rows } = await pool.query<RepairRow>(
    `SELECT * FROM (SELECT r.*, row_number() OVER (PARTITION BY source_id ORDER BY next_attempt_at) AS position
       FROM article_content_repairs r WHERE source_id = ANY($1::int[]) AND state = 'pending'
         AND attempts < 3 AND next_attempt_at <= now() AND first_failed_at > now() - interval '24 hours') due
     WHERE position <= 2 ORDER BY next_attempt_at LIMIT 10`, [ids]);
  const result = new Map<number, RepairItem[]>();
  for (const row of rows) result.set(row.source_id, [...result.get(row.source_id) ?? [], row.item]);
  await pool.query("DELETE FROM article_content_repairs WHERE updated_at < now() - interval '7 days' AND state <> 'pending'");
  return result;
}
