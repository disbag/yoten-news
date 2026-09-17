import fs from "node:fs";
import path from "node:path";

// Один общий lock-файл на пайплайн — личный однопользовательский инструмент,
// двух параллельных npm run fetch быть не должно (реальный случай: два
// прогона одновременно вставляли одну и ту же ссылку и один упал с
// unique_violation, см. ON CONFLICT в fetchAndProcess.ts — это защита ОТ
// падения при гонке, а lock ниже — защита от самой гонки).
const LOCK_PATH = path.join(process.cwd(), ".fetch.lock");
// Сколько можно не вызывать heartbeat(), прежде чем считать процесс
// зависшим. Между статьями пайплайн ждёт максимум пару секунд (паузы под
// rate limit) плюс время на сеть/саммаризацию — трёх минут с большим запасом
// хватает на одну статью в любых разумных условиях.
const HEARTBEAT_STALE_MS = 3 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

type LockData = { pid: number; startedAt: number; lastHeartbeat: number };

function readLock(): LockData | null {
  try {
    return JSON.parse(fs.readFileSync(LOCK_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function writeLock(): void {
  const data: LockData = { pid: process.pid, startedAt: Date.now(), lastHeartbeat: Date.now() };
  fs.writeFileSync(LOCK_PATH, JSON.stringify(data));
}

// kill(pid, 0) не посылает сигнал — просто проверяет, существует ли процесс
// с таким pid (бросает ESRCH, если нет).
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Вызывается своим же процессом на каждой обработанной статье — "я жив и
// продвигаюсь" для любого следующего запуска, который наткнётся на лок.
export function heartbeat(): void {
  writeLock();
}

// Перед стартом: если уже кто-то держит лок —
//  - процесс не существует (упал без очистки, напр. на process.exit до
//    finally) → лок устарел, удаляем и стартуем сразу;
//  - процесс жив, но давно не обновлял heartbeat → считаем зависшим
//    (например, застрял на сетевом запросе без таймаута), останавливаем его
//    (SIGTERM) и стартуем сами;
//  - процесс жив и недавно продвигался → он в порядке, просто ждём, пока
//    освободится, вместо того чтобы стартовать вторым и рисковать той же
//    гонкой на вставке статей.
export async function acquireLock(): Promise<void> {
  for (;;) {
    const lock = readLock();
    if (!lock || !isAlive(lock.pid)) {
      if (lock) console.log(`Найден устаревший lock-файл (pid ${lock.pid} уже не выполняется) — удаляю и продолжаю.`);
      break;
    }

    const sinceHeartbeat = Date.now() - lock.lastHeartbeat;
    if (sinceHeartbeat > HEARTBEAT_STALE_MS) {
      console.log(
        `Другой фетч (pid ${lock.pid}) не подавал признаков жизни ${Math.round(sinceHeartbeat / 1000)}с — похоже, завис. Останавливаю его и продолжаю сам.`
      );
      try {
        process.kill(lock.pid, "SIGTERM");
      } catch {
        // мог успеть сам завершиться между проверками — не страшно
      }
      await sleep(1000);
      break;
    }

    console.log(`Уже выполняется другой фетч (pid ${lock.pid}), прогресс идёт нормально — жду его завершения...`);
    await sleep(POLL_INTERVAL_MS);
  }

  writeLock();
}

export function releaseLock(): void {
  try {
    const lock = readLock();
    if (lock?.pid === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch {
    // не критично — следующий запуск переживёт это через проверку isAlive
  }
}
