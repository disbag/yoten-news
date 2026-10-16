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
const DIR = path.join(process.cwd(), "public", "favicons");
const force = process.argv.includes("--force");

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const hosts = [...new Set(SOURCES.map((s) => new URL(s.homepageUrl).hostname))].sort();
  let fetched = 0;
  let failed = 0;
  for (const host of hosts) {
    const file = path.join(DIR, `${host}.png`);
    if (!force && fs.existsSync(file)) continue;
    try {
      const res = await fetch(`https://www.google.com/s2/favicons?domain=${host}&sz=64`, {
        signal: AbortSignal.timeout(15_000),
      });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.startsWith("image/")) throw new Error(`${res.status} ${type}`);
      await sharp(Buffer.from(await res.arrayBuffer())).png().toFile(file);
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
