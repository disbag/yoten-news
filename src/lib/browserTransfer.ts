import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { resolveBrowserUser, withBrowserTransaction, type BrowserIdentity } from "./browserAccounts.js";
import { hashToken } from "./viewer.js";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const maxFailures = 5;

export async function createTransferCode(db: PoolClient, userId: number) {
  const token = Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join("");
  const code = token.match(/.{4}/g)!.join("-");
  const { rows } = await db.query<{ expires_at: Date }>(
    `INSERT INTO transfer_codes (code_hash, user_id, expires_at) VALUES ($1, $2, clock_timestamp() + interval '10 minutes')
     ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at
     RETURNING expires_at`,
    [hashToken(token), userId],
  );
  return { code, expiresAt: rows[0].expires_at.toISOString() };
}

export async function claimTransferCode(browser: BrowserIdentity, input: string) {
  const token = input.length <= 64 ? input.replace(/[\s-]/g, "").toUpperCase() : "";
  return withBrowserTransaction(async (db) => {
    const { rows: failures } = await db.query<{ attempts: number }>(
      "SELECT attempts FROM transfer_attempts WHERE token_hash = $1 AND expires_at > clock_timestamp()",
      [browser.hash],
    );
    const attempts = failures[0]?.attempts ?? 0;
    if (attempts >= maxFailures) return "blocked" as const;

    const { rows: codes } = await db.query<{ user_id: number }>(
      "DELETE FROM transfer_codes WHERE code_hash = $1 AND expires_at > clock_timestamp() RETURNING user_id",
      [/^[0-9A-HJKMNP-TV-Z]{16}$/.test(token) ? hashToken(token) : null],
    );
    const target = codes[0]?.user_id;
    if (target === undefined) {
      await db.query(
        `INSERT INTO transfer_attempts (token_hash, attempts, expires_at) VALUES ($1, $2, clock_timestamp() + interval '10 minutes')
         ON CONFLICT (token_hash) DO UPDATE SET attempts = EXCLUDED.attempts, expires_at = EXCLUDED.expires_at`,
        [browser.hash, attempts + 1],
      );
      return attempts + 1 >= maxFailures ? "blocked" as const : "invalid" as const;
    }

    const source = await resolveBrowserUser(db, browser, false);
    if (source !== null && source !== target) {
      await db.query(
        `INSERT INTO article_reads (user_id, cluster_id, read_at)
         SELECT $1, cluster_id, read_at FROM article_reads WHERE user_id = $2 ON CONFLICT DO NOTHING`,
        [target, source],
      );
      await db.query(
        `INSERT INTO user_hidden_sources (user_id, source_id, created_at)
         SELECT $1, source_id, created_at FROM user_hidden_sources WHERE user_id = $2 ON CONFLICT DO NOTHING`,
        [target, source],
      );
      await db.query("UPDATE browsers SET user_id = $1 WHERE user_id = $2", [target, source]);
      await db.query("DELETE FROM article_reads WHERE user_id = $1", [source]);
      await db.query("DELETE FROM user_hidden_sources WHERE user_id = $1", [source]);
      await db.query("DELETE FROM transfer_codes WHERE user_id = $1", [source]);
      // Старые ключи входа нельзя переносить между пользователями.
      await db.query("UPDATE users SET browser_token = NULL WHERE id = $1", [source]);
      await db.query("DELETE FROM users WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM passkeys WHERE user_id = $1)", [source]);
    }
    await db.query(
      `INSERT INTO browsers (token_hash, user_id, device_label) VALUES ($1, $2, $3)
       ON CONFLICT (token_hash) DO UPDATE SET last_seen_at = now(),
         device_label = coalesce(EXCLUDED.device_label, browsers.device_label)`,
      [browser.hash, target, browser.label],
    );
    await db.query("DELETE FROM transfer_attempts WHERE token_hash = $1", [browser.hash]);
    return "ok" as const;
  });
}

export async function resetBrowser(hash: string): Promise<void> {
  await withBrowserTransaction(async (db) => {
    const { rows } = await db.query<{ user_id: number }>("DELETE FROM browsers WHERE token_hash = $1 RETURNING user_id", [hash]);
    await db.query("UPDATE users SET browser_token = NULL WHERE browser_token = $1", [hash]);
    if (rows[0]) await db.query(
      "DELETE FROM transfer_codes WHERE user_id = $1 AND NOT EXISTS (SELECT 1 FROM browsers WHERE user_id = $1)",
      [rows[0].user_id],
    );
  });
}
