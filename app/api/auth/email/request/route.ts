import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../src/lib/db";
import {
  CODE_TTL_MINUTES,
  RESEND_COOLDOWN_SECONDS,
  generateCode,
  hashCode,
  isValidEmail,
  normalizeEmail,
  sendCodeEmail,
} from "../../../../../src/lib/emailCode";

export async function POST(request: NextRequest) {
  const { email: rawEmail } = (await request.json()) as { email?: string };
  const email = normalizeEmail(rawEmail ?? "");
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Введите корректный email" }, { status: 400 });
  }

  // Защита от спама письмами на чужой адрес: повторный запрос раньше, чем
  // через минуту после предыдущего, отклоняем.
  const { rows } = await pool.query(
    "SELECT EXTRACT(EPOCH FROM (now() - created_at)) AS age FROM email_login_codes WHERE email = $1",
    [email]
  );
  if (rows.length && Number(rows[0].age) < RESEND_COOLDOWN_SECONDS) {
    return NextResponse.json(
      { error: "Код уже отправлен, подождите минуту перед повторным запросом" },
      { status: 429 }
    );
  }

  const code = generateCode();
  await pool.query(
    `INSERT INTO email_login_codes (email, code_hash, expires_at, attempts, created_at)
     VALUES ($1, $2, now() + make_interval(mins => $3), 0, now())
     ON CONFLICT (email) DO UPDATE
       SET code_hash = EXCLUDED.code_hash,
           expires_at = EXCLUDED.expires_at,
           attempts = 0,
           created_at = now()`,
    [email, hashCode(email, code), CODE_TTL_MINUTES]
  );

  try {
    await sendCodeEmail(email, code);
  } catch (err) {
    console.error("Не удалось отправить код:", err);
    // Письмо не ушло — код всё равно лежит в базе и блокирует повторный
    // запрос на минуту (cooldown), а пользователь его не получил.
    await pool.query("DELETE FROM email_login_codes WHERE email = $1", [email]);
    return NextResponse.json({ error: "Не удалось отправить письмо, попробуйте позже" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
