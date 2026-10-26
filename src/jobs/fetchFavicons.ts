import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { SOURCES } from "../config/sources.js";

// Иконки изданий для карточек — файлами в public/favicons (DIS-68). Раньше
// браузер читателя сам запрашивал их у Google (google.com/s2/favicons), и
// Google видел, кто читает ленту и какие в ней издания. Теперь иконки
// скачиваются один раз этим скриптом и лежат в репозитории, а сайт отдаёт их
// со своего домена. При добавлении издания: `npm run favicons` — докачает
// только недостающие (`--force` — перекачать все).
//
// Имя файла — хост главной страницы издания (homepageUrl в sources.ts, он же
// sources.homepage_url в базе), как его строит FeedCard.tsx. Google отдаёт
// иконку то в PNG, то в JPEG (TechCrunch, Fast Company…) — приводим всё к PNG,
// чтобы адрес у всех был одного вида. sharp ставится вместе с Next.js.
//
// У части изданий Google знает только иконку 16×16 (Wired, House & Garden): в
// карточке она размыта. Тогда берём apple-touch-icon с самого сайта и
// уменьшаем до 64 px. Перекачать отдельные издания: `npm run favicons --
// www.wired.com`. После скачивания — проверить иконку на тёмной теме (см.
// FAVICON_LIGHT_BACKING в src/config/faviconBacking.ts).
const DIR = path.join(process.cwd(), "public", "favicons");
const force = process.argv.includes("--force");
const only = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const MIN_SIZE = 32;
const SIZE = 64;

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new Error(`${res.status} ${type}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const hosts = [...new Set(SOURCES.map((s) => new URL(s.homepageUrl).hostname))].sort();
  let fetched = 0;
  let failed = 0;
  for (const host of hosts) {
    const file = path.join(DIR, `${host}.png`);
    if (only.length ? !only.includes(host) : !force && fs.existsSync(file)) continue;
    try {
      let image = await download(`https://www.google.com/s2/favicons?domain=${host}&sz=${SIZE}`);
      if (((await sharp(image).metadata()).width ?? 0) < MIN_SIZE) {
        image = await download(`https://${host}/apple-touch-icon.png`)
          .then((icon) => sharp(icon).resize(SIZE, SIZE).toBuffer())
          .catch(() => image);
      }
      await sharp(image).png().toFile(file);
      fetched += 1;
    } catch (err) {
      failed += 1;
      console.error(`${host}: не удалось скачать иконку (${(err as Error).message})`);
    }
  }
  console.log(`Изданий: ${hosts.length}, скачано: ${fetched}, ошибок: ${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
