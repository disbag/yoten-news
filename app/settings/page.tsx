import { redirect } from "next/navigation";
import { getSessionUserId } from "../../src/lib/session";
import { getSettingsGroups } from "../../src/lib/sourcePrefs";
import SettingsView from "../components/SettingsView";

export const dynamic = "force-dynamic";

export const metadata = { title: "Настройка ленты — Yoten" };

// Настройка ленты (DIS-28, макет в Figma): какие издания показывать. Только
// для вошедших — у гостя настроек нет, как и пункта меню, ведущего сюда
// (см. Sidebar.tsx, MobileChrome.tsx).
export default async function SettingsPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");
  const groups = await getSettingsGroups(userId);
  return <SettingsView groups={groups} />;
}
