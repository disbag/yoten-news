import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 дней — passkey-логин не должен требовать повторного входа каждую неделю

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET не задан");
  return new TextEncoder().encode(secret);
}

export async function createSession(userId: number): Promise<void> {
  const token = await new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

// Возвращает null и на отсутствующей, и на битой/просроченной куке — вызывающий
// код везде трактует "не залогинен" одинаково, отдельная ошибка не нужна.
export async function getSessionUserId(): Promise<number | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return typeof payload.userId === "number" ? payload.userId : null;
  } catch {
    return null;
  }
}
