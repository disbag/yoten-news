import { getViewerDevices } from "../../../src/lib/viewer";
import SettingsShell from "../../components/SettingsShell";
import TransferSettings from "../../components/TransferSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Устройства — Yoten", referrer: "no-referrer" };
const activityDate = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Europe/Moscow" });

export default async function TransferPage() {
  const devices = (await getViewerDevices()).map(({ label, last_seen_at, current }) => ({
    label: label ?? "Неизвестное устройство",
    lastSeen: activityDate.format(last_seen_at),
    current,
  }));
  return <SettingsShell><TransferSettings devices={devices} /></SettingsShell>;
}
