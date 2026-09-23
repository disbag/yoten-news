"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

// Мини-галерея для источников с несколькими кадрами на статью (см. gallery в
// src/config/sources.ts). urls.length уже гарантированно >= 2 на уровне
// вызывающего кода (FeedCard.tsx), иначе показывается обычная одна картинка.
//
// Листается как в Instagram: все кадры стоят в ленте друг за другом и лента
// плавно сдвигается, а не подменяется src у одной картинки (тогда новый кадр
// начинал грузиться только по клику, и перелистывание "залипало" до конца
// загрузки). Свайп/перетаскивание ведёт ленту за пальцем. По кругу не
// листается — анимация с последнего кадра на первый проехала бы через все.
const SWIPE_THRESHOLD = 0.2; // доля ширины, после которой отпускание листает
const FLICK_MS = 250; // быстрый короткий взмах листает и без порога
const FLICK_PX = 30;

export default function Gallery({ urls }: { urls: string[] }) {
  const [index, setIndex] = useState(0);
  // Сломанные (402/битые байты — см. app/api/image-proxy/route.ts) кадры
  // исключаем из карусели по мере обнаружения, а не показываем битую иконку —
  // тот же принцип, что и для одиночной обложки в FeedCard.tsx.
  const [broken, setBroken] = useState<Set<string>>(new Set());
  // Кадрам ставим src не сразу все (карусели далеко внизу ленты не должны
  // качать по 10 фото), а текущий и соседние — и только после того, как
  // загрузился первый: он грузится лениво (loading="lazy"), то есть когда
  // карточка подъехала к экрану. Однажды загруженный кадр src не теряет.
  const [firstLoaded, setFirstLoaded] = useState(false);
  const [requested, setRequested] = useState<Set<string>>(() => new Set([urls[0]]));
  const [dragPx, setDragPx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; t: number; horizontal: boolean | null } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const firstImgRef = useRef<HTMLImageElement>(null);

  const workingUrls = urls.filter((u) => !broken.has(u));
  const last = workingUrls.length - 1;
  const current = Math.min(index, Math.max(last, 0));
  const neighbors = [current - 1, current, current + 1]
    .filter((i) => i >= 0 && i <= last)
    .map((i) => workingUrls[i]);
  const neighborsKey = neighbors.join("|");

  // Первая картинка приходит уже в серверном HTML и у верхних карточек
  // успевает загрузиться (или упасть) до гидрации — тогда onLoad/onError
  // React не видит, и соседние кадры не начали бы грузиться никогда.
  useEffect(() => {
    const img = firstImgRef.current;
    if (!img?.complete) return;
    if (img.naturalWidth === 0) setBroken((prev) => new Set(prev).add(urls[0]));
    setFirstLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только проверка состояния на момент гидрации
  }, []);

  useEffect(() => {
    if (!firstLoaded) return;
    setRequested((prev) => {
      if (neighbors.every((u) => prev.has(u))) return prev;
      const next = new Set(prev);
      neighbors.forEach((u) => next.add(u));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- neighborsKey и есть содержимое neighbors
  }, [firstLoaded, neighborsKey]);

  if (workingUrls.length === 0) return null;

  function markBroken(url: string) {
    setBroken((prev) => new Set(prev).add(url));
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, horizontal: null };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.horizontal === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      // Вертикальный жест — это прокрутка ленты, не наш (touch-action: pan-y
      // отдаёт её браузеру), горизонтальный — забираем себе.
      d.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!d.horizontal) {
        drag.current = null;
        return;
      }
      viewportRef.current?.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    // За крайние кадры тянется с сопротивлением, как в Instagram.
    const pastEdge = (dx > 0 && current === 0) || (dx < 0 && current === last);
    setDragPx(pastEdge ? dx / 3 : dx);
  }

  function endDrag(e: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const d = drag.current;
    drag.current = null;
    if (!d?.horizontal) return;
    setDragging(false);
    setDragPx(0);
    if (cancelled) return;
    const dx = e.clientX - d.x;
    const width = viewportRef.current?.offsetWidth ?? 1;
    const flick = e.timeStamp - d.t < FLICK_MS && Math.abs(dx) > FLICK_PX;
    if ((dx < -width * SWIPE_THRESHOLD || (flick && dx < 0)) && current < last) setIndex(current + 1);
    else if ((dx > width * SWIPE_THRESHOLD || (flick && dx > 0)) && current > 0) setIndex(current - 1);
  }

  return (
    <div className="gallery">
      <div
        ref={viewportRef}
        className="viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
      >
        <div
          className="track"
          style={{
            transform: `translateX(calc(${-current * 100}% + ${dragPx}px))`,
            transition: dragging ? "none" : undefined,
          }}
        >
          {workingUrls.map((url, i) => (
            <div className="slide" key={url}>
              {requested.has(url) && (
                // eslint-disable-next-line @next/next/no-img-element -- домены картинок непредсказуемы (любое издание), через /api/image-proxy как и одиночная обложка
                <img
                  ref={i === 0 ? firstImgRef : undefined}
                  src={`/api/image-proxy?url=${encodeURIComponent(url)}`}
                  alt=""
                  draggable={false}
                  loading={i === 0 ? "lazy" : "eager"}
                  onLoad={i === 0 ? () => setFirstLoaded(true) : undefined}
                  onError={() => {
                    markBroken(url);
                    // Иначе при битом первом кадре остальные не начали бы грузиться.
                    if (i === 0) setFirstLoaded(true);
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {current > 0 && (
        <button className="arrow left" aria-label="Предыдущее фото" onClick={() => setIndex(current - 1)}>
          ‹
        </button>
      )}
      {current < last && (
        <button className="arrow right" aria-label="Следующее фото" onClick={() => setIndex(current + 1)}>
          ›
        </button>
      )}
      {last > 0 && (
        <div className="dots">
          {workingUrls.map((url, i) => (
            <button
              key={url}
              className={i === current ? "dot active" : "dot"}
              aria-label={`Фото ${i + 1}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}

      <style jsx>{`
        .gallery {
          position: relative;
        }
        .viewport {
          overflow: hidden;
          border-radius: 14px;
          touch-action: pan-y;
          user-select: none;
          -webkit-user-select: none;
        }
        .track {
          display: flex;
          transition: transform 0.32s cubic-bezier(0.25, 0.8, 0.25, 1);
          will-change: transform;
        }
        .slide {
          flex: 0 0 100%;
          aspect-ratio: 1200 / 630;
          background: var(--card-hover);
        }
        .slide img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          -webkit-user-drag: none;
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
          pointer-events: none;
        }
        .dot {
          width: 6px;
          height: 6px;
          padding: 0;
          border: none;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.5);
          cursor: pointer;
          pointer-events: auto;
          transition: background 0.2s ease;
        }
        .dot.active {
          background: #fff;
        }
      `}</style>
    </div>
  );
}
