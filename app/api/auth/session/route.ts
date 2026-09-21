import { NextResponse } from "next/server";
import { pool } from "../../../../src/lib/db";
import { getSessionUserId } from "../../../../src/lib/session";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ user: null });

  const { rows } = await pool.query("SELECT id, display_name FROM users WHERE id = $1", [userId]);
  if (rows.length === 0) return NextResponse.json({ user: null });

  return NextResponse.json({ user: { id: rows[0].id, displayName: rows[0].display_name } });
}
