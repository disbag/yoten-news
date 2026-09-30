"use client";

import type { ReactNode } from "react";

// Общие элементы подразделов настроек: группа с заголовком и строка
// "название + переключатель справа" (по макету настройки ленты, DIS-28).
export function SettingsGroup({ title, children, role }: { title: string; children: ReactNode; role?: string }) {
  return (
    <section className="group" role={role} aria-label={role ? title : undefined}>
      <h2>{title}</h2>
      {children}
      <style jsx>{`
        .group {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        h2 {
          margin: 0;
          font-weight: 300;
          font-size: 13px;
          line-height: 20px;
          text-transform: uppercase;
          color: var(--text-muted);
        }
      `}</style>
    </section>
  );
}

export function SettingsRow({
  label,
  checked,
  role,
  onClick,
  children,
}: {
  label: string;
  checked: boolean;
  role: "switch" | "radio";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" role={role} aria-checked={checked} className="row" onClick={onClick}>
      <span className="name">{label}</span>
      {children}
      <style jsx>{`
        .row {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 0;
          border: none;
          background: none;
          font: inherit;
          text-align: left;
          cursor: pointer;
        }
        .name {
          flex: 1 0 0;
          min-width: 0;
          font-size: 20px;
          color: var(--text-soft);
        }
      `}</style>
    </button>
  );
}
