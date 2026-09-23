import { cookies } from "next/headers";

export const RP_NAME = "Yoten";
export const RP_ID = process.env.RP_ID ?? "localhost";
export const RP_ORIGIN = process.env.RP_ORIGIN ?? "http://localhost:3000";

const CHALLENGE_COOKIE = "webauthn_challenge";

// Между /options и /verify нужно пронести challenge (и для регистрации —
// displayName, который ввёл пользователь) без БД — эта пара живёт секунды,
// пока пользователь трогает authenticator. Кука короткоживущая и httpOnly,
// на неё не может повлиять клиентский JS, поэтому displayName внутри неё
// безопасен как источник для создания записи в users при verify.
type ChallengeData = { challenge: string; displayName?: string };

export async function setChallengeCookie(data: ChallengeData): Promise<void> {
  (await cookies()).set(CHALLENGE_COOKIE, JSON.stringify(data), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 5 * 60,
    path: "/",
  });
}

export async function getChallengeCookie(): Promise<ChallengeData | null> {
  const raw = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ChallengeData;
  } catch {
    return null;
  }
}

export async function clearChallengeCookie(): Promise<void> {
  (await cookies()).delete(CHALLENGE_COOKIE);
}
