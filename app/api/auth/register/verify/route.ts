import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { pool } from "../../../../../src/lib/db";
import { createSession } from "../../../../../src/lib/session";
import { RP_ID, RP_ORIGIN, getChallengeCookie, clearChallengeCookie } from "../../../../../src/lib/webauthn";

export async function POST(request: NextRequest) {
  const challengeData = await getChallengeCookie();
  if (!challengeData?.displayName) {
    console.error("[register/verify] нет куки webauthn_challenge — cookie не дошла или истекла");
    return NextResponse.json({ error: "Сессия регистрации истекла, начните заново" }, { status: 400 });
  }

  const response = (await request.json()) as RegistrationResponseJSON;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      // При создании просим userVerification: "preferred" (см. options) —
      // библиотека по умолчанию проверки требует true, что рассогласовано с
      // "preferred" при регистрации. На части macOS/Safari-конфигураций
      // платформенный authenticator подтверждает passkey без полноценной
      // биометрии (только presence), и со строгим требованием сервер
      // отклонял только что созданный ключ с "User verification was
      // required, but user could not be verified".
      requireUserVerification: false,
    });
  } catch (err) {
    console.error("[register/verify] verifyRegistrationResponse бросил ошибку:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  if (!verification.verified) {
    console.error("[register/verify] verified: false без исключения");
    return NextResponse.json({ error: "Не удалось подтвердить passkey" }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  const { rows } = await pool.query(
    "INSERT INTO users (display_name) VALUES ($1) RETURNING id, display_name",
    [challengeData.displayName]
  );
  const user = rows[0];
  await pool.query(
    "INSERT INTO passkeys (credential_id, user_id, public_key, counter, transports) VALUES ($1, $2, $3, $4, $5)",
    [credential.id, user.id, Buffer.from(credential.publicKey), credential.counter, credential.transports ?? null]
  );

  await createSession(user.id);
  await clearChallengeCookie();
  return NextResponse.json({ id: user.id, displayName: user.display_name });
}
