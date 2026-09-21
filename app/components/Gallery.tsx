"use client";

import { useState } from "react";

// Мини-галерея для источников с несколькими кадрами на статью (см. gallery в
// src/config/sources.ts) — стрелки + точки вместо одной обложки. urls.length
// уже гарантированно >= 2 на уровне вызывающего кода (FeedCard.tsx), иначе
// показывается обычная одна картинка без карусели.
export default function Gallery({ urls }: { urls: string[] }) {
  const [index, setIndex] = useState(0);

  function go(delta: number) {
    setIndex((i) => (i + delta + urls.length) % urls.length);
  }

  return (
    <div className="gallery">
      {/* eslint-disable-next-line @next/next/no-img-element -- домены картинок непредсказуемы (любое издание), через /api/image-proxy как и одиночная обложка */}
      <img
        src={`/api/image-proxy?url=${encodeURIComponent(urls[index])}`}
        alt=""
        className="cover"
        loading="lazy"
      />
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
        {urls.map((_, i) => (
          <button
            key={i}
            className={i === index ? "dot active" : "dot"}
            aria-label={`Фото ${i + 1}`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>

      <style jsx>{`
        .gallery {
          position: relative;
          margin-top: 16px;
        }
        .cover {
          display: block;
          width: 100%;
          max-height: 320px;
          object-fit: cover;
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
