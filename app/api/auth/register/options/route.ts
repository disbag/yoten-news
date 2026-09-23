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
    // authenticatorAttachment: "platform" — только встроенный Touch ID/Face
    // ID/Windows Hello. Без этого браузер показывает полный выбор способа
    // входа (в т.ч. QR-код на телефон, USB-ключ) вместо того, чтобы сразу
    // открыть системный диалог биометрии — так и произошло на проде, где ещё
    // не было ни одного passkey для этого домена (тот, что создан на
    // localhost, для другого origin не годится, WebAuthn их не смешивает).
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
      authenticatorAttachment: "platform",
    },
  });

  await setChallengeCookie({ challenge: options.challenge, displayName });
  return NextResponse.json(options);
}
