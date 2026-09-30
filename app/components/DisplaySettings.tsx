"use client";

import { useEffect, useState } from "react";
import {
  applyFontSize,
  applyTheme,
  FONT_SIZE_LABELS,
  FONT_SIZES,
  getStoredFontSize,
  getStoredTheme,
  type FontSize,
  type Theme,
} from "./theme";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
  { value: "system", label: "Системная" },
];

// "Настройки → Отображение": тема оформления (DIS-18) и размер текста
// новостей (DIS-19). Выбор применяется сразу и хранится в браузере (см.
// theme.ts); "Системная" тема следует за настройкой ОС и меняется вместе с
// ней без перезагрузки.
export default function DisplaySettings() {
  // До монтирования выбор неизвестен (localStorage есть только в браузере) —
  // ничего не отмечаем, чтобы серверная и клиентская разметка совпали.
  const [theme, setTheme] = useState<Theme | null>(null);
  const [fontSize, setFontSize] = useState<FontSize | null>(null);
  useEffect(() => {
    setTheme(getStoredTheme());
    setFontSize(getStoredFontSize());
  }, []);

  function choose(value: Theme) {
    applyTheme(value);
    setTheme(value);
  }

  const sizeIndex = fontSize ? FONT_SIZES.indexOf(fontSize) : -1;
  // Шаг — от сохранённого значения, а не от state: при быстрых кликах подряд
  // state ещё не успевает обновиться, и несколько нажатий давали один шаг.
  function stepFontSize(delta: number) {
    const next = FONT_SIZES[FONT_SIZES.indexOf(getStoredFontSize()) + delta];
    if (!next) return;
    applyFontSize(next);
    setFontSize(next);
  }

  return (
    <>
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

      <SettingsGroup title="Размер текста">
        <div className="size-row">
          <span className="size-name" aria-live="polite">
            {fontSize ? FONT_SIZE_LABELS[fontSize] : ""}
          </span>
          <button
            type="button"
            className="step"
            aria-label="Уменьшить текст"
            disabled={sizeIndex <= 0}
            onClick={() => stepFontSize(-1)}
          >
            −
          </button>
          <button
            type="button"
            className="step"
            aria-label="Увеличить текст"
            disabled={sizeIndex < 0 || sizeIndex >= FONT_SIZES.length - 1}
            onClick={() => stepFontSize(1)}
          >
            +
          </button>
        </div>
        {/* Образец — тем же шрифтом и масштабом, что текст новости в карточке
            (см. .summary в FeedCard.tsx). */}
        <p className="preview">
          Так будет выглядеть текст новостей в ленте — крупнее или мельче, как удобнее читать.
        </p>
        <style jsx>{`
          .size-row {
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .size-name {
            flex: 1 0 0;
            min-width: 0;
            font-size: 20px;
            color: var(--text-soft);
          }
          /* Кнопок в макете нет — круглые, контуром того же цвета, что и
             переключатели (--text-soft). */
          .step {
            width: 32px;
            height: 32px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            border: 1px solid var(--text-soft);
            border-radius: 50%;
            background: none;
            font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-weight: 300;
            font-size: 20px;
            line-height: 1;
            color: var(--text-soft);
            cursor: pointer;
          }
          .step:disabled {
            opacity: 0.3;
            cursor: default;
          }
          .preview {
            margin: 0;
            font-weight: 400;
            font-size: calc(15px * var(--font-scale));
            line-height: calc(20px * var(--font-scale));
            color: var(--text);
          }
          @media (max-width: 899px) {
            .preview {
              font-size: calc(1rem * var(--font-scale));
            }
          }
        `}</style>
      </SettingsGroup>
    </>
  );
}
