"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

// Мини-галерея для источников с несколькими кадрами на статью (см. gallery в
// src/config/sources.ts). urls.length уже гарантированно >= 2 на уровне
// вызывающего кода (FeedCard.tsx), иначе показывается обычная одна картинка.
//
// Листается как в Instagram: все кадры стоят в ленте друг за другом и лента
// плавно сдвигается, а не подменяется src у одной картинки (тогда новый кадр
// начинал грузиться только по клику, и перелистывание "залипало" до конца
// загрузки). Свайп/перетаскивание ведёт ленту за пальцем.
//
// Не по кругу: на первом кадре назад листать некуда, на последнем — вперёд.
// Стрелка в эту сторону скрыта, а лента за пальцем тянется с сопротивлением
// и возвращается на место.
//
// Тот же компонент — и просмотр на весь экран (fullscreen, см. Lightbox.tsx):
// листание должно быть ровно таким же, как в ленте, поэтому это не отдельная
// карусель, а другой размер кадра и пара отличий — кадры вписаны целиком,
// стрелки клавиатуры листают, взмах вниз или вверх закрывает. Только там фото
// можно увеличить: щипком или двойным нажатием. Увеличенное фото двигают
// пальцем; листание и закрытие взмахом в это время выключены, чтобы жесты не
// путались, — сначала фото возвращают к обычному размеру.
const SWIPE_THRESHOLD = 0.2; // доля ширины, после которой отпускание листает
const FLICK_MS = 250; // быстрый короткий взмах листает и без порога
const FLICK_PX = 30;
const DISMISS_PX = 90; // на сколько увести фото по вертикали, чтобы закрыть просмотр
// Увеличение фото на весь экран: щипком двумя пальцами или двойным нажатием.
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
type Zoom = { scale: number; x: number; y: number };
const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };

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
  // Номер текущего кадра в ленте, с нуля.
  const [pos, setPos] = useState(startIndex);
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
  const currentImgRef = useRef<HTMLImageElement>(null);
  // Увеличение текущего кадра (только на весь экран): масштаб и сдвиг.
  const [zoom, setZoomState] = useState<Zoom>(NO_ZOOM);
  // Последнее значение — сразу, не дожидаясь перерисовки: за один кадр
  // приходит несколько движений пальцев, и каждое считается от предыдущего.
  const zoomRef = useRef(zoom);
  function setZoom(next: Zoom) {
    zoomRef.current = next;
    setZoomState(next);
  }
  // Жест увеличения идёт — без анимации, фото должно идти точно за пальцами.
  const [zooming, setZooming] = useState(false);
  // Все пальцы на экране и то, с чего начался щипок или сдвиг увеличенного фото.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number; cx: number; cy: number } | null>(null);
  const pan = useRef<{ id: number; x: number; y: number; zx: number; zy: number } | null>(null);
  const lastTap = useRef(0);

  const workingUrls = urls.filter((u) => !broken.has(u));
  const n = workingUrls.length;
  // Кадр могли исключить как битый — номер не должен выйти за конец ленты.
  const current = Math.max(0, Math.min(pos, n - 1));
  const neighbors = [workingUrls[current - 1], workingUrls[current], workingUrls[current + 1]].filter(
    (u): u is string => Boolean(u)
  );
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

  // Safari на iPhone на щипок увеличивает всю страницу, и touch-action его не
  // останавливает — жест двумя пальцами на весь экран забираем себе явно.
  useEffect(() => {
    const view = viewportRef.current;
    if (!fullscreen || !view) return;
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    const onGesture = (e: Event) => e.preventDefault();
    view.addEventListener("touchstart", onTouch, { passive: false });
    view.addEventListener("touchmove", onTouch, { passive: false });
    document.addEventListener("gesturestart", onGesture);
    document.addEventListener("gesturechange", onGesture);
    return () => {
      view.removeEventListener("touchstart", onTouch);
      view.removeEventListener("touchmove", onTouch);
      document.removeEventListener("gesturestart", onGesture);
      document.removeEventListener("gesturechange", onGesture);
    };
  }, [fullscreen]);

  if (n === 0) return null;

  function go(delta: number) {
    setZoom(NO_ZOOM);
    setPos((p) => Math.max(0, Math.min(Math.min(p, n - 1) + delta, n - 1)));
  }

  // Сдвиг увеличенного фото — не дальше его края: пустоты за фото не видно.
  function clampZoom(scale: number, x: number, y: number): Zoom {
    const s = Math.max(1, Math.min(scale, MAX_ZOOM));
    const img = currentImgRef.current;
    const view = viewportRef.current;
    if (s === 1 || !img || !view) return NO_ZOOM;
    const maxX = Math.max(0, (img.offsetWidth * s - view.offsetWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * s - view.offsetHeight) / 2);
    return { scale: s, x: Math.max(-maxX, Math.min(x, maxX)), y: Math.max(-maxY, Math.min(y, maxY)) };
  }

  // Новый масштаб так, чтобы точка фото под пальцами (px, py) осталась под ними.
  function zoomAt(scale: number, px: number, py: number, from: Zoom = zoomRef.current): Zoom {
    const view = viewportRef.current?.getBoundingClientRect();
    if (!view) return from;
    const s = Math.max(1, Math.min(scale, MAX_ZOOM));
    const cx = px - (view.left + view.width / 2);
    const cy = py - (view.top + view.height / 2);
    const k = s / from.scale;
    return clampZoom(s, cx - (cx - from.x) * k, cy - (cy - from.y) * k);
  }

  function pinchState() {
    const [a, b] = [...pointers.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
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
    if (fullscreen) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        // Второй палец — это щипок, а не листание: начатый жест отменяем.
        drag.current = null;
        pan.current = null;
        setDragging(false);
        setDragPx(0);
        setDragY(0);
        moved.current = true;
        pinch.current = { ...pinchState(), scale: zoomRef.current.scale };
        setZooming(true);
        for (const id of pointers.current.keys()) {
          try {
            viewportRef.current?.setPointerCapture(id);
          } catch {}
        }
        return;
      }
      if (pointers.current.size > 2) return;
      if (zoomRef.current.scale > 1) {
        // Увеличенное фото одним пальцем двигают, а не листают.
        moved.current = false;
        pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, zx: zoomRef.current.x, zy: zoomRef.current.y };
        return;
      }
    }
    moved.current = false;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, horizontal: null };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (fullscreen && pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = pinch.current;
      if (p && pointers.current.size >= 2) {
        const now = pinchState();
        // Сначала сдвиг вслед за серединой между пальцами, затем масштаб вокруг неё.
        const z = zoomRef.current;
        const moved2 = { scale: z.scale, x: z.x + (now.cx - p.cx), y: z.y + (now.cy - p.cy) };
        setZoom(zoomAt((p.scale * now.dist) / p.dist, now.cx, now.cy, moved2));
        pinch.current = { dist: now.dist, cx: now.cx, cy: now.cy, scale: Math.max(1, Math.min((p.scale * now.dist) / p.dist, MAX_ZOOM)) };
        return;
      }
      const m = pan.current;
      if (m && m.id === e.pointerId) {
        const dx = e.clientX - m.x;
        const dy = e.clientY - m.y;
        if (!moved.current && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (!moved.current) {
          moved.current = true;
          setZooming(true);
          try {
            viewportRef.current?.setPointerCapture(e.pointerId);
          } catch {}
        }
        setZoom(clampZoom(zoomRef.current.scale, m.zx + dx, m.zy + dy));
        return;
      }
    }
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
    // За край ленты (первый кадр вправо, последний влево) тянется втрое туже.
    const pastEdge = (current === 0 && dx > 0) || (current === n - 1 && dx < 0);
    if (d.horizontal) setDragPx(pastEdge ? dx / 3 : dx);
    else setDragY(dy);
  }

  function endDrag(e: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    if (fullscreen) {
      pointers.current.delete(e.pointerId);
      if (pinch.current) {
        if (pointers.current.size >= 2) {
          pinch.current = { ...pinchState(), scale: zoomRef.current.scale };
          return;
        }
        // Щипок закончен. Почти обычный размер — возвращаем ровно к нему.
        pinch.current = null;
        setZooming(false);
        if (zoomRef.current.scale < 1.05) setZoom(NO_ZOOM);
        // Оставшийся палец продолжает двигать увеличенное фото.
        const [rest] = [...pointers.current.entries()];
        pan.current =
          rest && zoomRef.current.scale >= 1.05
            ? { id: rest[0], x: rest[1].x, y: rest[1].y, zx: zoomRef.current.x, zy: zoomRef.current.y }
            : null;
        return;
      }
      if (pan.current?.id === e.pointerId) {
        pan.current = null;
        setZooming(false);
        return;
      }
    }
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
          if (moved.current) {
            moved.current = false;
            return;
          }
          // Двойное нажатие по фото на весь экран — увеличить в этой точке или
          // вернуть обычный размер.
          if (fullscreen && e.target instanceof HTMLImageElement) {
            const doubleTap = e.timeStamp - lastTap.current < DOUBLE_TAP_MS;
            lastTap.current = doubleTap ? 0 : e.timeStamp;
            if (doubleTap) {
              setZoom(zoomRef.current.scale > 1 ? NO_ZOOM : zoomAt(DOUBLE_TAP_ZOOM, e.clientX, e.clientY));
              return;
            }
          }
          onTap?.(current, e.target);
        }}
      >
        <div
          className="track"
          style={{
            transform: `translate(calc(${-current * 100}% + ${dragPx}px), ${dragY}px)`,
            transition: dragging ? "none" : undefined,
            opacity: dragY ? Math.max(0.3, 1 - Math.abs(dragY) / 400) : undefined,
          }}
        >
          {workingUrls.map((url, i) => {
            // Ленивая загрузка — только для первого кадра карусели в ленте.
            const isFirst = !fullscreen && url === workingUrls[0];
            const zoomed = fullscreen && i === current && zoom.scale > 1;
            return (
              <div className={upright.has(url) ? "slide upright" : "slide"} key={url}>
                {requested.has(url) && (
                  // eslint-disable-next-line @next/next/no-img-element -- домены картинок непредсказуемы (любое издание), через /api/image-proxy как и одиночная обложка
                  <img
                    ref={isFirst ? firstImgRef : fullscreen && i === current ? currentImgRef : undefined}
                    src={`/api/image-proxy?url=${encodeURIComponent(url)}`}
                    alt=""
                    draggable={false}
                    style={
                      zoomed
                        ? {
                            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
                            transition: zooming ? "none" : undefined,
                            cursor: "grab",
                          }
                        : undefined
                    }
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

      {/* После отсева битых кадров может остаться один — листать нечего.
          Пока фото увеличено, стрелки и точки убраны: они закрывали бы его. */}
      {n > 1 && zoom.scale === 1 && (
        <>
          {current > 0 && (
            <button className="arrow left" aria-label="Предыдущее фото" onClick={() => go(-1)}>
              ‹
            </button>
          )}
          {current < n - 1 && (
            <button className="arrow right" aria-label="Следующее фото" onClick={() => go(1)}>
              ›
            </button>
          )}
          <div className="dots">
            {workingUrls.map((url, i) => (
              <button
                key={url}
                className={i === current ? "dot active" : "dot"}
                aria-label={`Фото ${i + 1}`}
                onClick={() => setPos(i)}
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
          transition: transform 0.2s ease;
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
