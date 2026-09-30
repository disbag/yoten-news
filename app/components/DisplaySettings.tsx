"use client";

import { useEffect, useState } from "react";
import { applyTheme, getStoredTheme, type Theme } from "./theme";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
  { value: "system", label: "Системная" },
];

// "Настройки → Отображение" (DIS-18): тема оформления. Выбор применяется
// сразу и хранится в браузере (см. theme.ts), "Системная" — следует за
// настройкой ОС и меняется вместе с ней без перезагрузки.
export default function DisplaySettings() {
  // До монтирования выбор неизвестен (localStorage есть только в браузере) —
  // ничего не отмечаем, чтобы серверная и клиентская разметка совпали.
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(getStoredTheme()), []);

  function choose(value: Theme) {
    applyTheme(value);
    setTheme(value);
  }

  return (
    <SettingsGroup title="Тема" role="radiogroup">
      {OPTIONS.map((option) => (
        <SettingsRow
          key={option.value}
          role="radio"
          label={option.label}
          checked={theme === option.value}
          onClick={() => choose(option.value)}
        >
          <span className={theme === option.value ? "radio checked" : "radio"} aria-hidden="true" />
        </SettingsRow>
      ))}
      <style jsx>{`
        /* Отдельной иконки в макете нет — круг в стиле переключателя из
           макета (тот же контур #3d3d3d, та же зелёная "включено"). */
        .radio {
          position: relative;
          width: 24px;
          height: 24px;
          flex-shrink: 0;
        }
        .radio::before {
          content: "";
          position: absolute;
          inset: 3px;
          border: 1px solid var(--text-soft);
          border-radius: 50%;
        }
        .radio.checked::after {
          content: "";
          position: absolute;
          inset: 8px;
          border: 1px solid var(--text-soft);
          border-radius: 50%;
          background: #6ee7b7;
        }
      `}</style>
    </SettingsGroup>
  );
}
