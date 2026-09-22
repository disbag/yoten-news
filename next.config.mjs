/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // По умолчанию клиентский Router Cache в Next 14 держит RSC-пейлоад
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
