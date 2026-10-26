import Link from "next/link";

// Ссылка на пост, которого уже нет: новости хранятся неделю (см.
// RETENTION_DAYS в fetchAndProcess.ts), ссылка может прожить дольше.
export default function PostNotFound() {
  return (
    <div className="shell">
      <main>
        <div className="post-gone">
          <Link href="/" className="home-link" aria-label="Yoten — на главную">
            {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG */}
            <img src="/logo-desktop.svg" alt="Yoten" width={96} height={55} className="theme-invert" />
          </Link>
          <p>Этого поста уже нет: новости в Yoten хранятся неделю.</p>
          <Link href="/">Открыть свежую ленту</Link>
        </div>
      </main>
    </div>
  );
}
