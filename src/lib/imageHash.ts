import sharp from "sharp";
import { pool } from "./db.js";
import { BROWSER_USER_AGENT } from "./http.js";

// Отпечатки картинок для галереи треда (DIS-36): одно и то же фото у разных
// изданий (агентский снимок AP/Getty) лежит по разным адресам и в разных
// размерах — по адресу дубль не узнать. dHash: картинка сжимается до 9×8 в
// оттенках серого, и для каждого пикселя записывается, светлее ли он соседа
// справа, — 64 бита. У одного снимка в разных размерах и с разным сжатием
// отпечатки совпадают или отличаются на несколько бит, у разных снимков —
// примерно на половину.

const BROWSER_HEADERS = {
  "User-Agent": BROWSER_USER_AGENT,
};
// Те же пределы, что у прокси картинок (app/api/image-proxy/route.ts).
const FETCH_TIMEOUT_MS = 15_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

async function dHash(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    if (Number(res.headers.get("content-length")) > MAX_IMAGE_BYTES) return null;
    const pixels = await sharp(Buffer.from(await res.arrayBuffer()))
      .grayscale()
      .resize(9, 8, { fit: "fill" })
      .raw()
      .toBuffer();
    let bits = "";
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) bits += pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? "1" : "0";
    }
    return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
  } catch {
    return null;
  }
}

// Считает и сохраняет отпечатки картинок, которых ещё нет в image_hashes.
// Неудачная загрузка тоже запоминается (hash NULL), чтобы не качать снова.
export async function ensureImageHashes(urls: string[]): Promise<void> {
  const unique = [...new Set(urls.filter(Boolean))];
  if (!unique.length) return;
  const { rows } = await pool.query("SELECT url FROM image_hashes WHERE url = ANY($1)", [unique]);
  const known = new Set(rows.map((r) => r.url as string));
  for (const url of unique) {
    if (known.has(url)) continue;
    const hash = await dHash(url);
    await pool.query("INSERT INTO image_hashes (url, hash) VALUES ($1, $2) ON CONFLICT (url) DO NOTHING", [url, hash]);
  }
}
