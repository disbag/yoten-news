"use client";

import { useEffect, useRef, useState, type PointerEvent, type TransitionEvent } from "react";

// Мини-галерея для источников с несколькими кадрами на статью (см. gallery в
// src/config/sources.ts). urls.length уже гарантированно >= 2 на уровне
// вызывающего кода (FeedCard.tsx), иначе показывается обычная одна картинка.
//
// Листается как в Instagram: все кадры стоят в ленте друг за другом и лента
// плавно сдвигается, а не подменяется src у одной картинки (тогда новый кадр
// начинал грузиться только по клику, и перелистывание "залипало" до конца
// загрузки). Свайп/перетаскивание ведёт ленту за пальцем.
//
// По кругу — бесшовно: по краям ленты стоят копии (перед первым кадром —
// копия последнего, после последнего — копия первого). С последнего кадра
// лента едет вперёд на копию первого, а когда анимация закончилась, без
// анимации перескакивает на настоящий первый — со стороны это одно плавное
// движение, а не откат назад через все кадры.
//
// Тот же компонент — и просмотр на весь экран (fullscreen, см. Lightbox.tsx):
// листание должно быть ровно таким же, как в ленте, поэтому это не отдельная
// карусель, а другой размер кадра и пара отличий — кадры вписаны целиком,
// стрелки клавиатуры листают, взмах вниз или вверх закрывает.
const SWIPE_THRESHOLD = 0.2; // доля ширины, после которой отпускание листает
const FLICK_MS = 250; // быстрый короткий взмах листает и без порога
const FLICK_PX = 30;
const DISMISS_PX = 90; // на сколько увести фото по вертикали, чтобы закрыть просмотр

export default function Gallery({
  urls,
  fullscreen = false,
  startIndex = 0,
  onTap,
  onClose,
}: {
  urls: string[];
  fullscreen?: boolean;
  // С какого кадра открыть (для просмотра на весь экран).
  startIndex?: number;
  // Нажатие без перетаскивания: номер кадра и то, по чему попали.
  onTap?: (index: number, target: EventTarget) => void;
  onClose?: () => void;
}) {
  // Позиция в ленте с копиями: 0 — копия последнего, 1..n — настоящие кадры,
  // n+1 — копия первого.
  const [pos, setPos] = useState(startIndex + 1);
  // Перескок с копии на настоящий кадр — без анимации.
  const [instant, setInstant] = useState(false);
  // Сломанные (402/битые байты — см. app/api/image-proxy/route.ts) кадры
  // исключаем из карусели по мере обнаружения, а не показываем битую иконку —
  // тот же принцип, что и для одиночной обложки в FeedCard.tsx.
  const [broken, setBroken] = useState<Set<string>>(new Set());
  // Вертикальные (и квадратные) кадры в широкой рамке 16:9 при cover
  // теряли бо́льшую часть кадра — их вписываем целиком, поля по бокам чёрные.
  // Ориентацию узнаём только после загрузки, по натуральным размерам.
  const [upright, setUpright] = useState<Set<string>>(new Set());
  // Кадрам ставим src не сразу все (карусели далеко внизу ленты не должны
  // качать по 10 фото), а текущий и соседние — и только после того, как
  // загрузился первый: он грузится лениво (loading="lazy"), то есть когда
  // карточка подъехала к экрану. Однажды загруженный кадр src не теряет.
  // На весь экран кадр открывают нажатием, он нужен сразу — без ожидания.
  const [firstLoaded, setFirstLoaded] = useState(fullscreen);
  const [requested, setRequested] = useState<Set<string>>(() => new Set([urls[fullscreen ? startIndex : 0]]));
  const [dragPx, setDragPx] = useState(0);
  // Вертикальное смещение — только на весь экран: фото тянется за пальцем.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; t: number; horizontal: boolean | null } | null>(null);
  // Жест был перетаскиванием — следующий за ним click не считаем нажатием.
  const moved = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const firstImgRef = useRef<HTMLImageElement>(null);

  const workingUrls = urls.filter((u) => !broken.has(u));
  const n = workingUrls.length;
  const safePos = Math.min(pos, n + 1);
  const current = n ? (((safePos - 1) % n) + n) % n : 0;
  const neighbors = n ? [workingUrls[(current - 1 + n) % n], workingUrls[current], workingUrls[(current + 1) % n]] : [];
  const neighborsKey = neighbors.join("|");

  // Первая картинка приходит уже в серверном HTML и у верхних карточек
  // успевает загрузиться (или упасть) до гидрации — тогда onLoad/onError
  // React не видит, и соседние кадры не начали бы грузиться никогда.
  useEffect(() => {
    const img = firstImgRef.current;
    if (!img?.complete) return;
    if (img.naturalWidth === 0) setBroken((prev) => new Set(prev).add(urls[0]));
    else checkUpright(urls[0], img);
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

  // После перескока без анимации возвращаем анимацию — через два кадра, чтобы
  // браузер успел применить новую позицию без transition.
  useEffect(() => {
    if (!instant) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
    return () => cancelAnimationFrame(id);
  }, [instant]);

  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go читает только n, он в зависимостях
  }, [fullscreen, n]);

  if (n === 0) return null;

  function go(delta: number) {
    // Пока лента стоит на копии, дальше ехать некуда — ждём перескока на
    // настоящий кадр (он случится в конце текущей анимации).
    if (n < 2) return;
    setPos((p) => (p === 0 || p === n + 1 ? p : p + delta));
  }

  function onTransitionEnd(e: TransitionEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget || e.propertyName !== "transform") return;
    if (safePos === n + 1) {
      setInstant(true);
      setPos(1);
    } else if (safePos === 0) {
      setInstant(true);
      setPos(n);
    }
  }

  function markBroken(url: string) {
    setBroken((prev) => new Set(prev).add(url));
  }

  function checkUpright(url: string, img: HTMLImageElement) {
    if (img.naturalWidth > img.naturalHeight) return;
    setUpright((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    moved.current = false;
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
      moved.current = true;
      // В ленте вертикальный жест — прокрутка страницы; на весь экран
      // прокручивать нечего, им закрывают просмотр.
      if (!d.horizontal && !fullscreen) {
        drag.current = null;
        return;
      }
      // Захват бросает NotFoundError, если указатель уже не активен (палец
      // отпущен между событиями) — без захвата жест просто закончится раньше.
      try {
        viewportRef.current?.setPointerCapture(e.pointerId);
      } catch {}
      setDragging(true);
    }
    if (d.horizontal) setDragPx(dx);
    else setDragY(dy);
  }

  function endDrag(e: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.horizontal === null) return;
    setDragging(false);
    setDragPx(0);
    setDragY(0);
    if (!d.horizontal) {
      if (!cancelled && Math.abs(e.clientY - d.y) > DISMISS_PX) onClose?.();
      return;
    }
    if (cancelled) return;
    const dx = e.clientX - d.x;
    const width = viewportRef.current?.offsetWidth ?? 1;
    const flick = e.timeStamp - d.t < FLICK_MS && Math.abs(dx) > FLICK_PX;
    if (dx < -width * SWIPE_THRESHOLD || (flick && dx < 0)) go(1);
    else if (dx > width * SWIPE_THRESHOLD || (flick && dx > 0)) go(-1);
  }

  // Лента с копиями по краям — см. коммент вверху файла.
  const slides = [
    { key: "clone-last", url: workingUrls[n - 1], real: false },
    ...workingUrls.map((url) => ({ key: url, url, real: true })),
    { key: "clone-first", url: workingUrls[0], real: false },
  ];

  return (
    <div className={fullscreen ? "gallery fullscreen" : "gallery"}>
      <div
        ref={viewportRef}
        className="viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
        onClick={(e) => {
          // click приходит и после перетаскивания — это не нажатие.
          if (moved.current) moved.current = false;
          else onTap?.(current, e.target);
        }}
      >
        <div
          className="track"
          onTransitionEnd={onTransitionEnd}
          style={{
            transform: `translate(calc(${-safePos * 100}% + ${dragPx}px), ${dragY}px)`,
            transition: dragging || instant ? "none" : undefined,
            opacity: dragY ? Math.max(0.3, 1 - Math.abs(dragY) / 400) : undefined,
          }}
        >
          {slides.map(({ key, url, real }) => {
            // Ленивая загрузка — только для первого кадра карусели в ленте.
            const isFirst = !fullscreen && real && url === workingUrls[0];
            return (
              <div className={upright.has(url) ? "slide upright" : "slide"} key={key}>
                {requested.has(url) && (
                  // eslint-disable-next-line @next/next/no-img-element -- домены картинок непредсказуемы (любое издание), через /api/image-proxy как и одиночная обложка
                  <img
                    ref={isFirst ? firstImgRef : undefined}
                    src={`/api/image-proxy?url=${encodeURIComponent(url)}`}
                    alt=""
                    draggable={false}
                    loading={isFirst ? "lazy" : "eager"}
                    onLoad={(e) => {
                      checkUpright(url, e.currentTarget);
                      if (isFirst) setFirstLoaded(true);
                    }}
                    onError={() => {
                      markBroken(url);
                      // Иначе при битом первом кадре остальные не начали бы грузиться.
                      if (isFirst) setFirstLoaded(true);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* После отсева битых кадров может остаться один — листать нечего. */}
      {n > 1 && (
        <>
          <button className="arrow left" aria-label="Предыдущее фото" onClick={() => go(-1)}>
            ‹
          </button>
          <button className="arrow right" aria-label="Следующее фото" onClick={() => go(1)}>
            ›
          </button>
          <div className="dots">
            {workingUrls.map((url, i) => (
              <button
                key={url}
                className={i === current ? "dot active" : "dot"}
                aria-label={`Фото ${i + 1}`}
                onClick={() => setPos(i + 1)}
              />
            ))}
          </div>
        </>
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
          transition:
            transform 0.32s cubic-bezier(0.25, 0.8, 0.25, 1),
            opacity 0.2s ease;
          will-change: transform;
        }
        .slide {
          flex: 0 0 100%;
          /* 16:9 — пропорции большинства фото изданий, см. .cover в FeedCard.tsx */
          aspect-ratio: 16 / 9;
          background: var(--card-hover);
        }
        .slide img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          -webkit-user-drag: none;
        }
        .slide.upright {
          background: #000;
        }
        .slide.upright img {
          object-fit: contain;
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
        .gallery:not(.fullscreen) .viewport {
          cursor: zoom-in;
        }
        /* Просмотр на весь экран: кадр занимает всё окно и вписан целиком. */
        .fullscreen {
          position: absolute;
          inset: 0;
        }
        .fullscreen .viewport {
          height: 100%;
          border-radius: 0;
          touch-action: none;
        }
        .fullscreen .track {
          height: 100%;
        }
        .fullscreen .slide,
        .fullscreen .slide.upright {
          aspect-ratio: auto;
          height: 100%;
          background: transparent;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .fullscreen .slide img {
          width: auto;
          height: auto;
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }
        .fullscreen .arrow {
          width: 44px;
          height: 44px;
          font-size: 1.7rem;
        }
        .fullscreen .arrow.left {
          left: 16px;
        }
        .fullscreen .arrow.right {
          right: 16px;
        }
        .fullscreen .dots {
          bottom: calc(18px + env(safe-area-inset-bottom));
        }
        @media (max-width: 899px) {
          /* На телефоне листают пальцем — стрелки только закрывали бы фото. */
          .fullscreen .arrow {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
