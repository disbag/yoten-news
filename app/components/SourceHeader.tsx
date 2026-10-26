"use client";

import { useState } from "react";
import { FAVICON_LIGHT_BACKING } from "../../src/config/faviconBacking";
import { faviconUrl } from "./FeedCard";

// Шапка страницы издания (DIS-80): иконка, название, адрес сайта.
export default function SourceHeader({ name, homepage }: { name: string; homepage: string }) {
  const [faviconMissing, setFaviconMissing] = useState(false);
  const favicon = faviconMissing ? null : faviconUrl(homepage);
  const host = homepage.replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "");

  return (
    <div className="source-header">
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
      <div className="text">
        <h1>{name}</h1>
        <a href={homepage} target="_blank" rel="noopener noreferrer">
          {host}
        </a>
      </div>
      <style jsx>{`
        .source-header {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .icon {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          flex-shrink: 0;
          object-fit: cover;
        }
        .icon.backing {
          background: #fff;
          padding: 4px;
        }
        .icon.placeholder {
          display: block;
          background: var(--border);
        }
        .text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        h1 {
          margin: 0;
          font-size: 20px;
          line-height: 26px;
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
      `}</style>
    </div>
  );
}
