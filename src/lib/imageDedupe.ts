// Сравнение отпечатков картинок (DIS-36) — отдельно от imageHash.ts, чтобы
// лента (src/lib/feed.ts) не тянула sharp: отпечатки считает только сбор.

// Сколько бит может отличаться у одного и того же снимка. Проверка 16
// октября: снимок Guardian в двух размерах — 0 бит, кадр Car and Driver в
// оригинале и уменьшенный до 320 px — 5 бит, два разных кадра той же машины —
// 32, совсем разные фото — 32. 10 — с запасом для копий, далеко от разных.
export const SAME_IMAGE_MAX_DISTANCE = 10;

export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

// Убирает повторы из списка картинок, сохраняя порядок: одинаковый адрес или
// отпечаток, отличающийся не больше чем на SAME_IMAGE_MAX_DISTANCE бит.
// Картинки без отпечатка (не скачались) сравниваются только по адресу.
export function dedupeImages(urls: string[], hashes: Map<string, string | null>): string[] {
  const kept: string[] = [];
  const keptHashes: string[] = [];
  for (const url of urls) {
    if (kept.includes(url)) continue;
    const hash = hashes.get(url);
    if (hash && keptHashes.some((h) => hammingDistance(h, hash) <= SAME_IMAGE_MAX_DISTANCE)) continue;
    kept.push(url);
    if (hash) keptHashes.push(hash);
  }
  return kept;
}
