import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { pool } from "./db.js";

// Посетитель — это браузер (DIS-65): регистрации нет, прочитанное и
// выключенные издания хранятся в базе под случайным номером из куки, которую
// выдаёт middleware.ts. В базе лежит не сам номер, а его SHA-256: утечка
// таблицы не даёт подставить чужую куку.
export const BROWSER_COOKIE = "yoten_browser";

// Строку в users заводит первое действие — отметка прочитанного или
// переключатель издания, — а не визит: иначе строку получал бы каждый бот.
// Больше MAX_NEW_PER_MINUTE новых браузеров в минуту — скорее бот, чем люди.
const MAX_NEW_PER_MINUTE = 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Кука входа до DIS-65 (подписанный JWT с userId, жила 90 дней): её владелец
// при первом визите получает свой аккаунт под номером браузера. Последние
// такие куки выданы 26 октября 2026 — после 24 января 2027 проверку и
// SESSION_SECRET можно убрать.
const LEGACY_SESSION_COOKIE = "session";
async function legacyUserId(token: string | undefined): Promise<number | null> {
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return typeof payload.userId === "number" ? payload.userId : null;
  } catch {
    return null;
  }
}

// Номер пользователя для этого браузера или null, если строки ещё нет.
// create — завести строку (только для действий, не для чтения ленты).
export async function getViewerId({ create = false } = {}): Promise<number | null> {
  const jar = await cookies();
  const token = jar.get(BROWSER_COOKIE)?.value;
  if (!token) return null;
  const hash = hashToken(token);

  // last_seen_at — для удаления давно не заходивших (см. cleanupOld в
  // fetchAndProcess.ts); пишется не чаще раза в сутки.
  const { rows } = await pool.query<{ id: number }>(
    `WITH u AS (SELECT id, last_seen_at FROM users WHERE browser_token = $1),
          touch AS (UPDATE users SET last_seen_at = now() FROM u
                    WHERE users.id = u.id AND u.last_seen_at < now() - interval '1 day')
     SELECT id FROM u`,
    [hash]
  );
  if (rows[0]) return rows[0].id;

  const legacy = await legacyUserId(jar.get(LEGACY_SESSION_COOKIE)?.value);
  if (legacy !== null) {
    // Аккаунт уже привязан к другому браузеру — пока жива кука входа, этот
    // браузер работает под тем же аккаунтом, потом начнёт с нуля.
    await pool.query("UPDATE users SET browser_token = $1, last_seen_at = now() WHERE id = $2 AND browser_token IS NULL", [
      hash,
      legacy,
    ]);
    return legacy;
  }

  if (!create) return null;
  const { rows: recent } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM users WHERE created_at > now() - interval '1 minute'"
  );
  if (recent[0].n >= MAX_NEW_PER_MINUTE) return null;
  // ON CONFLICT — два первых действия браузера, пришедшие одновременно,
  // получают одну строку.
  const { rows: created } = await pool.query<{ id: number }>(
    `INSERT INTO users (display_name, browser_token) VALUES ('browser', $1)
     ON CONFLICT (browser_token) DO UPDATE SET last_seen_at = now()
     RETURNING id`,
    [hash]
  );
  return created[0].id;
}
