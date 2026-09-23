import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { RP_ID, setChallengeCookie } from "../../../../../src/lib/webauthn";

// allowCredentials намеренно не задаём — resident key (см. authenticatorSelection
// в register/options) позволяет браузеру самому показать пользователю все
// подходящие passkey для этого rpID, без предварительного ввода имени.
export async function POST() {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
  });

  await setChallengeCookie({ challenge: options.challenge });
  return NextResponse.json(options);
}
