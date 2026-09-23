import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { pool } from "../../../../../src/lib/db";
import { createSession } from "../../../../../src/lib/session";
import { RP_ID, RP_ORIGIN, getChallengeCookie, clearChallengeCookie } from "../../../../../src/lib/webauthn";

export async function POST(request: NextRequest) {
  const challengeData = await getChallengeCookie();
  if (!challengeData) {
    console.error("[login/verify] нет куки webauthn_challenge — cookie не дошла или истекла");
    return NextResponse.json({ error: "Сессия входа истекла, попробуйте снова" }, { status: 400 });
  }

  const response = (await request.json()) as AuthenticationResponseJSON;

  const { rows } = await pool.query(
    "SELECT user_id, public_key, counter, transports FROM passkeys WHERE credential_id = $1",
    [response.id]
  );
  if (rows.length === 0) {
    console.error("[login/verify] credential_id не найден в БД:", response.id);
    return NextResponse.json({ error: "Passkey не найден" }, { status: 400 });
  }
  const passkey = rows[0];

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: response.id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: Number(passkey.counter),
        transports: passkey.transports ?? undefined,
      },
      // См. комментарий в register/verify — соответствует userVerification:
      // "preferred" при создании/входе, а не жёсткому требованию по умолчанию.
      requireUserVerification: false,
    });
  } catch (err) {
    console.error("[login/verify] verifyAuthenticationResponse бросил ошибку:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  if (!verification.verified) {
    console.error("[login/verify] verified: false без исключения");
    return NextResponse.json({ error: "Не удалось подтвердить passkey" }, { status: 400 });
  }

  await pool.query("UPDATE passkeys SET counter = $1 WHERE credential_id = $2", [
    verification.authenticationInfo.newCounter,
    response.id,
  ]);

  await createSession(passkey.user_id);
  await clearChallengeCookie();
  return NextResponse.json({ ok: true });
}
