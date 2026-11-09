import { pool } from "../../../src/lib/db";
import { getViewerId } from "../../../src/lib/viewer";
import SettingsShell from "../../components/SettingsShell";
import TransferSettings from "../../components/TransferSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Устройства — Yoten", referrer: "no-referrer" };

export default async function TransferPage() {
  const userId = await getViewerId();
  const count = userId === null ? 0 : (await pool.query<{ count: number }>(
    "SELECT greatest(count(*) - 1, 0)::int AS count FROM browsers WHERE user_id = $1",
    [userId],
  )).rows[0].count;
  return <SettingsShell><TransferSettings connected={count} /></SettingsShell>;
}
