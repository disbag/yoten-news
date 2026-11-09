import type { PoolClient } from "pg";
import { pool } from "./db.js";

export type BrowserIdentity = { hash: string; legacyId: number | null; label: string | null };

// Запись истории, перенос и чистка используют один порядок. Запрос, пришедший
// во время переноса, запишет отметку уже в общую историю.
export async function withBrowserTransaction<T>(run: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(790065)");
    const result = await run(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export async function findBrowserUser(db: Pick<PoolClient, "query">, { hash, label }: BrowserIdentity): Promise<number | null> {
  const { rows } = await db.query<{ user_id: number }>(
    `WITH browser AS (SELECT user_id FROM browsers WHERE token_hash = $1),
          touch AS (UPDATE browsers SET last_seen_at = now(), device_label = coalesce($2::text, device_label)
                    WHERE token_hash = $1 AND (last_seen_at < now() - interval '1 day'
                      OR ($2::text IS NOT NULL AND device_label IS DISTINCT FROM $2)))
     SELECT user_id FROM browser`,
    [hash, label],
  );
  return rows[0]?.user_id ?? null;
}

// Вызывать внутри withBrowserTransaction. Подхватываем и браузеры, которые
// старая версия могла создать между миграцией и переключением приложения.
export async function resolveBrowserUser(db: PoolClient, browser: BrowserIdentity, create: boolean): Promise<number | null> {
  const { hash, legacyId, label } = browser;
  const existing = await findBrowserUser(db, browser);
  if (existing !== null) return existing;

  const { rows: migrated } = await db.query<{ user_id: number }>(
    `INSERT INTO browsers (token_hash, user_id, device_label)
     SELECT $1, id, $3 FROM users WHERE browser_token = $1 OR id = $2
     ORDER BY (browser_token IS NOT DISTINCT FROM $1) DESC LIMIT 1
     RETURNING user_id`,
    [hash, legacyId, label],
  );
  if (migrated[0]) return migrated[0].user_id;
  if (!create) return null;

  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (display_name) SELECT 'browser'
     WHERE (SELECT count(*) FROM users WHERE created_at > now() - interval '1 minute') < 30
     RETURNING id`,
  );
  if (!rows[0]) return null;
  const id = rows[0].id;
  await db.query("INSERT INTO browsers (token_hash, user_id, device_label) VALUES ($1, $2, $3)", [hash, id, label]);
  return id;
}

export async function cleanupBrowsers(): Promise<number> {
  return withBrowserTransaction(async (db) => {
    await db.query("DELETE FROM transfer_codes WHERE expires_at <= now()");
    await db.query("DELETE FROM transfer_attempts WHERE expires_at <= now()");
    const removed = await db.query<{ token_hash: string }>(
      "DELETE FROM browsers WHERE last_seen_at < now() - interval '1 year' RETURNING token_hash",
    );
    // Иначе запасное чтение старой колонки восстановит удалённую привязку.
    await db.query("UPDATE users SET browser_token = NULL WHERE browser_token = ANY($1::text[])", [removed.rows.map(row => row.token_hash)]);
    const stale = `SELECT id FROM users u WHERE last_seen_at < now() - interval '1 year'
      AND NOT EXISTS (SELECT 1 FROM browsers b WHERE b.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id)`;
    await db.query(`DELETE FROM article_reads WHERE user_id IN (${stale})`);
    await db.query(`DELETE FROM users WHERE id IN (${stale})`);
    return removed.rowCount ?? 0;
  });
}
