import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../src/lib/db";
import { createSession } from "../../../../../src/lib/session";
import { isValidEmail, normalizeEmail } from "../../../../../src/lib/emailCode";

// Упрощённая регистрация по email — без одноразового кода (в отличие от
// /api/auth/email/request + /verify, которые уже готовы для будущего входа
// по почте). Владение адресом здесь не проверяется, поэтому эндпоинт умеет
// ТОЛЬКО создавать новый аккаунт: на уже занятый email — 409, а не вход.
// Раньше тут был ON CONFLICT DO UPDATE + createSession, и знания чужого email
// хватало, чтобы войти в чужой аккаунт.
export async function POST(request: NextRequest) {
  const { email: rawEmail } = (await request.json()) as { email?: string };
  const email = normalizeEmail(rawEmail ?? "");
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Введите корректный email" }, { status: 400 });
  }

  const { rows } = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, display_name`,
    [email, email.split("@")[0]]
  );
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Этот email уже зарегистрирован — войдите через Face ID" },
      { status: 409 }
    );
  }

  const user = rows[0];
  await createSession(user.id);
  return NextResponse.json({ id: user.id, displayName: user.display_name });
}
