/**
 * Применяет описания из data/book-descriptions.json в PostgreSQL (без повторной загрузки с сайтов).
 */
require("dotenv").config({ override: true });
const fs = require("fs");
const path = require("path");
const { pool } = require("../db/pool");

const CACHE_PATH = path.join(__dirname, "../data/book-descriptions.json");

async function main() {
  if (!fs.existsSync(CACHE_PATH)) {
    console.error("Нет кэша:", CACHE_PATH);
    process.exit(1);
  }
  const cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  const entries = Object.entries(cache).filter(([, v]) => v?.description?.length >= 80);

  console.log(`Применяем ${entries.length} описаний…`);

  let updated = 0;
  for (const [id, entry] of entries) {
    await pool.query("UPDATE books SET description = $2 WHERE id = $1", [
      Number(id),
      entry.description,
    ]);
    updated += 1;
  }

  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM books");
  console.log(`Готово. Обновлено: ${updated}. Всего книг в базе: ${rows[0].n}`);
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
