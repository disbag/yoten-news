import { NextResponse } from "next/server";
import { clearSession } from "../../../../src/lib/session";

export async function POST() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
