/** @type {import('next').NextConfig} */
const nextConfig = {
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
