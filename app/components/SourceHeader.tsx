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

  return (
    <div className="source-header">
      <div className="row">
        <Link href="/" className="back" aria-label="Назад в ленту">
          {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG из макета */}
          <img src="/back-desktop.svg" alt="" width={24} height={24} className="theme-invert" />
        </Link>
        {favicon ? (
          // eslint-disable-next-line @next/next/no-img-element -- маленькие статичные файлы из public/favicons
          <img
            src={favicon}
            alt=""
            className={FAVICON_LIGHT_BACKING.has(name) ? "icon backing" : "icon"}
            onError={() => setFaviconMissing(true)}
          />
        ) : (
          <span className="icon placeholder" />
        )}
        <div className="title">
          <h1>{name}</h1>
          <a href={homepage} target="_blank" rel="noopener noreferrer">
            {host}
          </a>
        </div>
      </div>
      {description && <p className="description">{description}</p>}
      <style jsx>{`
        .source-header {
          display: flex;
          flex-direction: column;
          gap: 12px;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .row :global(.back) {
          display: flex;
          flex-shrink: 0;
          margin-left: -4px;
        }
        .icon {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          flex-shrink: 0;
          object-fit: cover;
        }
        .icon.backing {
          background: #fff;
          padding: 6px;
        }
        .icon.placeholder {
          display: block;
          background: var(--border);
        }
        .title {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        h1 {
          margin: 0;
          font-size: 22px;
          line-height: 28px;
          font-weight: 400;
          color: var(--text);
        }
        a {
          font-size: 13px;
          line-height: 18px;
          font-weight: 300;
          color: var(--text-muted);
          text-decoration: none;
        }
        a:hover {
          color: var(--accent);
        }
        .description {
          margin: 0;
          font-size: 15px;
          line-height: 22px;
          font-weight: 300;
          color: var(--text-soft);
        }
      `}</style>
    </div>
  );
}
