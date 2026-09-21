import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { pool } from "../../../../../src/lib/db";
import { RP_NAME, RP_ID, setChallengeCookie } from "../../../../../src/lib/webauthn";

// Без ручного ввода имени — WebAuthn всё равно требует user.name/displayName
// (это чисто служебная строка для системных списков сохранённых passkey в
// ОС, не то, что видит пользователь в нашем интерфейсе), генерируем сами
// порядковым номером: user-01, user-02, ... (passkey_user_seq в схеме).
export async function POST() {
  const { rows } = await pool.query(
    "SELECT 'user-' || lpad(nextval('passkey_user_seq')::text, 2, '0') AS name"
  );
  const displayName: string = rows[0].name;

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: displayName,
    userDisplayName: displayName,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });

  setChallengeCookie({ challenge: options.challenge, displayName });
  return NextResponse.json(options);
}
