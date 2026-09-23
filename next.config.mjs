import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Иначе Next 15 ищет корень по lockfile вверх по дереву и локально цепляется
  // за посторонний ~/package-lock.json вне проекта.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  experimental: {
    // В Next 15 это уже значение по умолчанию, но оно здесь намеренно
    // закреплено: в Next 14 клиентский Router Cache держал RSC-пейлоад
    // страницы 30 секунд ПОСЛЕ ухода с неё — даже для страниц с
    // dynamic="force-dynamic" (тот флаг лишь про рендер на сервере, кэш
    // роутера в браузере — отдельный механизм). На вкладках "Новые"/
    // "Прочитанные" (app/page.tsx) это давало ровно баг из отчёта: уходишь
    // на "Прочитанные", возвращаешься на "Новые" в пределах 30 секунд —
    // видишь старый снимок с ДО того, как скролл пометил статьи
    // прочитанными, будто отметки исчезли. staleTimes.dynamic: 0 отключает
    // это кэширование — каждый переход по Link всегда идёт на сервер заново.
    staleTimes: {
      dynamic: 0,
    },
  },
  // Базовые защитные заголовки (HSTS Vercel уже добавляет сам). Полноценный
  // CSP не ставим: styled-jsx и Next.js вставляют инлайн-стили/скрипты, и без
  // nonce-инфраструктуры он бы сломал страницу.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  webpack(config) {
    // src/ пишется в стиле Node ESM (импорты с расширением .js на .ts-файлы),
    // как того требует связка tsx + moduleResolution "Bundler" для CLI-скриптов.
    // Учим webpack резолвить те же .js-импорты в .ts/.tsx при сборке фронтенда.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
