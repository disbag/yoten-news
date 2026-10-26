import { getViewerId } from "../../src/lib/viewer";
import { getSettingsGroups } from "../../src/lib/sourcePrefs";
import SettingsShell from "../components/SettingsShell";
import SourcesSettings from "../components/SourcesSettings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Настройки — Yoten" };

// "Настройки → Источники" (DIS-28, макет в Figma): какие издания показывать.
export default async function SettingsPage() {
  const groups = await getSettingsGroups(await getViewerId());
  return (
    <SettingsShell>
      <SourcesSettings groups={groups} />
    </SettingsShell>
  );
}
