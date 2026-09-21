import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../src/lib/db";
import { createSession } from "../../../../../src/lib/session";
import { MAX_ATTEMPTS, hashCode, isValidEmail, normalizeEmail } from "../../../../../src/lib/emailCode";

export async function POST(request: NextRequest) {
  const { email: rawEmail, code: rawCode } = (await request.json()) as { email?: string; code?: string };
  const email = normalizeEmail(rawEmail ?? "");
  const code = (rawCode ?? "").replace(/\s/g, "");
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Введите шестизначный код из письма" }, { status: 400 });
  }

  // Попытка списывается ДО сравнения и одним атомарным UPDATE — параллельные
  // запросы с разными догадками не смогут обойти лимит MAX_ATTEMPTS.
  const { rows } = await pool.query(
    `UPDATE email_login_codes
     SET attempts = attempts + 1
     WHERE email = $1 AND expires_at > now() AND attempts < $2
     RETURNING code_hash`,
    [email, MAX_ATTEMPTS]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "Код истёк или попытки закончились, запросите новый" }, { status: 400 });
  }

  const expected = Buffer.from(rows[0].code_hash, "hex");
  const actual = Buffer.from(hashCode(email, code), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.json({ error: "Неверный код" }, { status: 400 });
  }

  await pool.query("DELETE FROM email_login_codes WHERE email = $1", [email]);

  // Аккаунт создаётся при первом успешном входе с этого адреса.
  const { rows: users } = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email, email.split("@")[0]]
  );

  await createSession(users[0].id);
  return NextResponse.json({ ok: true });
}
