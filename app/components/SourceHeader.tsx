"use client";

import { useState } from "react";
import Link from "next/link";
import { FAVICON_LIGHT_BACKING } from "../../src/config/faviconBacking";
import { faviconUrl } from "./FeedCard";

// Шапка страницы издания (DIS-80): стрелка назад в ленту, крупная иконка,
// название, адрес сайта и пара предложений о том, что это за издание.
export default function SourceHeader({
  name,
  homepage,
  description,
}: {
  name: string;
  homepage: string;
  description?: string;
}) {
  const [faviconMissing, setFaviconMissing] = useState(false);
  const favicon = faviconMissing ? null : faviconUrl(homepage);
  const host = homepage.replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "");

  // По макету Figma «Desktop : PageSource» (узел 41:209): стрелка 20 px, иконка
  // 48 px, название жирным с доменом в строку, описание мелким серым.
  return (
    <div className="source-header">
      <Link href="/" className="back" aria-label="Назад в ленту">
        {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG из макета */}
        <img src="/back-desktop.svg" alt="" width={20} height={20} className="theme-invert" />
      </Link>
      <div className="identity">
        {favicon ? (
          // eslint-disable-next-line @next/next/no-img-element -- маленькие статичные файлы из public/favicons
          <img
            src={favicon}
            alt=""
            className={FAVICON_LIGHT_BACKING.has(name) ? "icon favicon-backing" : "icon"}
            onError={() => setFaviconMissing(true)}
          />
        ) : (
          <span className="icon placeholder" />
        )}
        <div className="text">
          <div className="title">
            <h1>{name}</h1>
            <a href={homepage} target="_blank" rel="noopener noreferrer">
              {host}
            </a>
          </div>
          {description && <p className="description">{description}</p>}
        </div>
      </div>
      <style jsx>{`
        .source-header {
          display: flex;
          align-items: center;
          gap: 16px;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 400;
        }
        .source-header :global(.back) {
          display: flex;
          flex-shrink: 0;
          width: 20px;
          height: 20px;
        }
        .source-header :global(.back img) {
          width: 20px;
          height: 20px;
        }
        .identity {
          flex: 1 0 0;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .icon {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          flex-shrink: 0;
          object-fit: cover;
        }
        .icon.placeholder {
          display: block;
          background: var(--border);
        }
        .text {
          flex: 1 0 0;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .title {
          display: flex;
          align-items: center;
          gap: 8px;
          white-space: nowrap;
        }
        h1 {
          margin: 0;
          font-size: 16px;
          line-height: 20px;
          font-weight: 700;
          color: var(--text);
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        a {
          font-size: 10px;
          line-height: 12px;
          color: var(--text-dim);
          text-decoration: none;
          /* Если строка тесна, первым сжимается домен, а не название. */
          min-width: 0;
          flex-shrink: 100;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @media (hover: hover) and (pointer: fine) {
          a:hover {
            color: var(--accent);
          }
        }
        .description {
          margin: 0;
          font-size: 12px;
          line-height: 14px;
          color: var(--text-dim);
        }
        /* На телефоне домен — второй строкой под названием. */
        @media (max-width: 899px) {
          .title {
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
          }
          .title > * {
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
