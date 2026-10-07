import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pool } from "../lib/db.js";
import { SOURCES } from "../config/sources.js";

async function main() {
  const schema = fs.readFileSync(path.join(process.cwd(), "db/schema.sql"), "utf-8");
  await pool.query(schema);
  console.log("Схема применена");

  // У издания с несколькими фидами (extraFeeds) — по строке на фид, все с
  // одним названием.
  for (const s of SOURCES) {
    for (const rssUrl of [s.rssUrl, ...(s.extraFeeds ?? [])]) {
      await pool.query(
        `INSERT INTO sources (name, rss_url, homepage_url)
         VALUES ($1, $2, $3)
         ON CONFLICT (rss_url) DO NOTHING`,
        [s.name, rssUrl, s.homepageUrl]
      );
    }
  }
  // Издание, которое пользователь выключил в настройках, остаётся выключенным
  // и для фидов, добавленных ему позже: отметка распространяется на все
  // строки с тем же названием.
  await pool.query(
    `INSERT INTO user_hidden_sources (user_id, source_id)
     SELECT DISTINCT h.user_id, same.id
     FROM user_hidden_sources h
     JOIN sources hidden ON hidden.id = h.source_id
     JOIN sources same ON same.name = hidden.name
     ON CONFLICT DO NOTHING`
  );
  console.log(`Источники добавлены (${SOURCES.length})`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
