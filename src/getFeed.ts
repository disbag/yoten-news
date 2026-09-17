import "dotenv/config";
import { pool } from "./lib/db.js";
import { getFeed } from "./lib/feed.js";

async function main() {
  const feed = await getFeed();

  for (const item of feed) {
    const sourceNames = item.sources.map((s) => s.name).join(", ");
    console.log(`\n[${item.sources.length} источник(а/ов): ${sourceNames}] ${item.summary}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
