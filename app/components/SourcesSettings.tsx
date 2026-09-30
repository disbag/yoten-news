"use client";

import { useState } from "react";
import type { SettingsGroup as Group } from "../../src/lib/sourcePrefs";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

// "Настройки → Источники" — издания по группам с переключателем у каждого
// (макет DIS-28). Выключенные хранятся у пользователя в базе, лента их
// прячет (см. getFeed в src/lib/feed.ts).
export default function SourcesSettings({ groups: initialGroups }: { groups: Group[] }) {
  const [groups, setGroups] = useState(initialGroups);
  const [error, setError] = useState(false);

  function setEnabled(sourceId: number, enabled: boolean) {
    setGroups((prev) =>
      prev.map((group) => ({
        ...group,
        sources: group.sources.map((s) => (s.id === sourceId ? { ...s, enabled } : s)),
      }))
    );
  }

  // Переключаем сразу, не дожидаясь ответа, — при ошибке возвращаем назад.
  async function toggle(sourceId: number, enabled: boolean) {
    setEnabled(sourceId, enabled);
    setError(false);
    try {
      const res = await fetch("/api/settings/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, enabled }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setEnabled(sourceId, !enabled);
      setError(true);
    }
  }

  return (
    <>
      {error && <p className="error">Не удалось сохранить — попробуйте ещё раз</p>}
      {groups.map((group) => (
        <SettingsGroup key={group.label} title={group.label}>
          {group.sources.map((source) => (
            <SettingsRow
              key={source.id}
              role="switch"
              label={source.name}
              checked={source.enabled}
              onClick={() => toggle(source.id, !source.enabled)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG из макета */}
              <img
                src={source.enabled ? "/toggle-on.svg" : "/toggle-off.svg"}
                alt=""
                width={24}
                height={24}
                className="toggle theme-invert-toggle"
              />
            </SettingsRow>
          ))}
        </SettingsGroup>
      ))}
      <style jsx>{`
        .error {
          margin: 0;
          font-size: 14px;
          color: var(--accent);
        }
        .toggle {
          display: block;
          flex-shrink: 0;
        }
      `}</style>
    </>
  );
}
