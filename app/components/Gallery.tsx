"use client";

import { useState } from "react";

// Мини-галерея для источников с несколькими кадрами на статью (см. gallery в
// src/config/sources.ts) — стрелки + точки вместо одной обложки. urls.length
// уже гарантированно >= 2 на уровне вызывающего кода (FeedCard.tsx), иначе
// показывается обычная одна картинка без карусели.
export default function Gallery({ urls }: { urls: string[] }) {
  const [index, setIndex] = useState(0);
  // Сломанные (402/битые байты — см. app/api/image-proxy/route.ts) кадры
  // просто исключаем из карусели по мере обнаружения, а не показываем
  // битую иконку — тот же принцип, что и для одиночной обложки в
  // FeedCard.tsx.
  const [broken, setBroken] = useState<Set<string>>(new Set());

  const workingUrls = urls.filter((u) => !broken.has(u));
  if (workingUrls.length === 0) return null;
  const safeIndex = index % workingUrls.length;

  function go(delta: number) {
    setIndex((i) => (i + delta + workingUrls.length) % workingUrls.length);
  }

  function markBroken(url: string) {
    setBroken((prev) => new Set(prev).add(url));
  }

  return (
    <div className="gallery">
      {/* eslint-disable-next-line @next/next/no-img-element -- домены картинок непредсказуемы (любое издание), через /api/image-proxy как и одиночная обложка */}
      <img
        src={`/api/image-proxy?url=${encodeURIComponent(workingUrls[safeIndex])}`}
        alt=""
        className="cover"
        loading="lazy"
        onError={() => markBroken(workingUrls[safeIndex])}
      />
      {workingUrls.length > 1 && (
        <>
          <button
            className="arrow left"
            aria-label="Предыдущее фото"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
          >
            ‹
          </button>
          <button
            className="arrow right"
            aria-label="Следующее фото"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
          >
            ›
          </button>
          <div className="dots" onClick={(e) => e.stopPropagation()}>
            {workingUrls.map((_, i) => (
              <button
                key={i}
                className={i === safeIndex ? "dot active" : "dot"}
                aria-label={`Фото ${i + 1}`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        </>
      )}

      <style jsx>{`
        .gallery {
          position: relative;
        }
        .cover {
          display: block;
          width: 100%;
          aspect-ratio: 1200 / 630;
          object-fit: cover;
          border-radius: 14px;
        }
        .arrow {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: none;
          background: rgba(0, 0, 0, 0.4);
          color: #fff;
          font-size: 1.3rem;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .arrow:hover {
          background: rgba(0, 0, 0, 0.6);
        }
        .arrow.left {
          left: 10px;
        }
        .arrow.right {
          right: 10px;
        }
        .dots {
          position: absolute;
          bottom: 10px;
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
          gap: 6px;
        }
        .dot {
          width: 6px;
          height: 6px;
          padding: 0;
          border: none;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.5);
          cursor: pointer;
        }
        .dot.active {
          background: #fff;
        }
      `}</style>
    </div>
  );
}
