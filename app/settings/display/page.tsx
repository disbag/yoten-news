import SettingsShell from "../../components/SettingsShell";
import DisplaySettings from "../../components/DisplaySettings";

export const metadata = { title: "Отображение — Yoten" };

// "Настройки → Отображение" (DIS-18): тема оформления и размер текста,
// хранятся в браузере.
export default function DisplaySettingsPage() {
  return (
    <SettingsShell>
      <DisplaySettings />
    </SettingsShell>
  );
}
