import path from "node:path";
import { env, pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

// Кеш модели — в .cache в корне проекта, а не по умолчанию библиотеки
// (node_modules/@xenova/transformers/.cache): именно .cache сохраняет между
// прогонами шаг "Cache embedding model" в .github/workflows/fetch-cron.yml.
// Раньше пути не совпадали — кеш ни разу не сохранялся ("Path Validation
// Error" в каждом прогоне), и модель заново качалась с Hugging Face при
// каждом запуске фетча.
env.cacheDir = path.join(process.cwd(), ".cache");

// Модель качается один раз и кешируется локально при первом запуске (~90MB).
// Работает полностью локально, без API-ключа и без затрат — хорошо подходит
// для частого вызова на каждую новую статью.
let extractor: FeatureExtractionPipeline | null = null;

async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractor;
}

export async function embed(text: string): Promise<number[]> {
  const model = await getExtractor();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}
