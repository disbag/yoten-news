import { redirect } from "next/navigation";
import { getSessionUserId } from "../../src/lib/session";
import { getSettingsGroups } from "../../src/lib/sourcePrefs";
import SettingsShell from "../components/SettingsShell";
import SourcesSettings from "../components/SourcesSettings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Настройки — Yoten" };

// "Настройки → Источники" (DIS-28, макет в Figma): какие издания показывать.
// Только для вошедших — у гостя настроек изданий нет, его ведём в
// "Отображение" (тема хранится в браузере и доступна всем, DIS-18).
export default async function SettingsPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/settings/display");
  const groups = await getSettingsGroups(userId);
  return (
    <SettingsShell isLoggedIn>
      <SourcesSettings groups={groups} />
    </SettingsShell>
  );
}
