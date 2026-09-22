import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../src/lib/db";
import { createSession } from "../../../../../src/lib/session";
import { isValidEmail, normalizeEmail } from "../../../../../src/lib/emailCode";

// Упрощённая регистрация по email — без одноразового кода (в отличие от
// /api/auth/email/request + /verify, которые уже готовы для будущего входа
// по почте). Пока это просто способ завести аккаунт по email вместо passkey,
// без проверки владения адресом — тот же уровень доверия, что раньше был у
// регистрации по имени. ON CONFLICT — повторная "регистрация" на уже
// существующий email просто входит в тот же аккаунт, а не падает ошибкой.
export async function POST(request: NextRequest) {
  const { email: rawEmail } = (await request.json()) as { email?: string };
  const email = normalizeEmail(rawEmail ?? "");
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Введите корректный email" }, { status: 400 });
  }

  const { rows } = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, display_name`,
    [email, email.split("@")[0]]
  );
  const user = rows[0];
  await createSession(user.id);
  return NextResponse.json({ id: user.id, displayName: user.display_name });
}
