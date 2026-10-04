"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Gallery from "./Gallery";

// Просмотр фото новости на весь экран (DIS-32): тёмный фон, листание — та же
// карусель, что и в ленте (см. Gallery.tsx). Одиночная обложка открывается
// так же, просто листать нечего. Закрывается крестиком, Esc, нажатием мимо
// фото или взмахом вверх/вниз.
export default function Lightbox({
  urls,
  startIndex = 0,
  onClose,
}: {
  urls: string[];
  startIndex?: number;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // onClose у вызывающего кода — новая функция на каждый рендер; эффект ниже
  // должен отработать один раз на открытие, а не переставлять фокус заново.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    // Лента под просмотром не должна прокручиваться.
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const prevFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      root.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Просмотр фото">
      <Gallery
        urls={urls}
        fullscreen
        startIndex={startIndex}
        onClose={onClose}
        onTap={(_, target) => {
          // Нажатие по самому фото ничего не делает, мимо него — закрывает.
          if (!(target instanceof HTMLImageElement)) onClose();
        }}
      />
      <button ref={closeRef} className="close" aria-label="Закрыть" onClick={onClose}>
        ✕
      </button>

      <style jsx>{`
        .lightbox {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(0, 0, 0, 0.94);
          animation: fade 0.18s ease;
        }
        .close {
          position: absolute;
          top: calc(14px + env(safe-area-inset-top));
          right: 14px;
          width: 40px;
          height: 40px;
          border: none;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.12);
          color: #fff;
          font-size: 1.05rem;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .close:hover {
          background: rgba(255, 255, 255, 0.22);
        }
        @keyframes fade {
          from {
            opacity: 0;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
