import { getSessionUserId } from "../../../src/lib/session";
import SettingsShell from "../../components/SettingsShell";
import DisplaySettings from "../../components/DisplaySettings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Отображение — Yoten" };

// "Настройки → Отображение" (DIS-18): тема оформления, для всех — выбор
// хранится в браузере. Сессия нужна только чтобы показать вошедшему второй
// подраздел — "Источники".
export default async function DisplaySettingsPage() {
  const userId = await getSessionUserId();
  return (
    <SettingsShell isLoggedIn={userId !== null}>
      <DisplaySettings />
    </SettingsShell>
  );
}
