import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pool } from "../lib/db.js";
import { SOURCES } from "../config/sources.js";

async function main() {
  const schema = fs.readFileSync(path.join(process.cwd(), "db/schema.sql"), "utf-8");
  await pool.query(schema);
  console.log("Схема применена");

  for (const s of SOURCES) {
    await pool.query(
      `INSERT INTO sources (name, rss_url, homepage_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (rss_url) DO NOTHING`,
      [s.name, s.rssUrl, s.homepageUrl]
    );
  }
  console.log(`Источники добавлены (${SOURCES.length})`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
