import "dotenv/config";
import { pool } from "../lib/db.js";
import { assignThreads } from "../lib/threads.js";

// Раскладка карточек по тредам (DIS-36) отдельным прогоном — для догрузки
// за прошлые часы и ручной проверки (при сборе она идёт сама).
// THREADS_SINCE_HOURS — за сколько часов брать непроверенные карточки (по
// умолчанию 24), THREADS_LIMIT — не больше N карточек за прогон, THREADS_IDS —
// только перечисленные карточки.
async function main() {
  const sinceHours = Number(process.env.THREADS_SINCE_HOURS ?? 24);
  const limit = process.env.THREADS_LIMIT ? Number(process.env.THREADS_LIMIT) : undefined;
  // THREADS_IDS="20971,21345" — проверить только эти карточки.
  const clusterIds = process.env.THREADS_IDS?.split(",").map(Number).filter(Boolean);
  const stats = await assignThreads({ sinceHours, limit, clusterIds });
  console.log(
    `Треды: проверено ${stats.checked}, без кандидатов ${stats.noCandidates}, присоединено ${stats.joined}, новых тредов ${stats.created}, слито ${stats.merged}` +
      (stats.stoppedByQuota ? " — остановлено: квота Gemini исчерпана" : "")
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
