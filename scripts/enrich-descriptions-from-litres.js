/**
 * Подтягивает аннотации с ЛитРес (поле download_url) и обновляет description в БД.
 *
 * npm run enrich:descriptions
 * npm run enrich:descriptions -- --limit=20
 * npm run enrich:descriptions -- --dry-run
 */
require("dotenv").config({ override: true });
const fs = require("fs");
const path = require("path");
const { pool } = require("../db/pool");
const { fetchBookDescription } = require("./litres-description");

const CACHE_PATH = path.join(__dirname, "../data/book-descriptions.json");
const DELAY_MS = Number(process.env.LITRES_FETCH_DELAY_MS) || 1400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    limit: Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || 0,
    force: args.includes("--force"),
  };
}

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

async function loadBooks() {
  const { rows } = await pool.query(
    `SELECT b.id, b.title, a.name AS author, b.description, b.download_url
     FROM books b
     JOIN authors a ON a.id = b.author_id
     WHERE b.download_url ILIKE '%litres.ru%'
     ORDER BY b.id ASC`
  );
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    author: row.author,
    description: row.description || "",
    downloadUrl: row.download_url,
  }));
}

async function main() {
  const { dryRun, limit, force } = parseArgs();
  const cache = loadCache();
  const books = await loadBooks();
  const targets = limit > 0 ? books.slice(0, limit) : books;

  console.log(`Книг с ЛитРес: ${books.length}, обработаем: ${targets.length}`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const book of targets) {
    const cached = cache[String(book.id)];
    if (!force && cached?.description && cached.description.length >= 120) {
      skipped += 1;
      continue;
    }

    try {
      console.log(`[${book.id}] ${book.title}`);
      const { description, source } = await fetchBookDescription({
        title: book.title,
        author: book.author,
        downloadUrl: book.downloadUrl,
      });
      cache[String(book.id)] = {
        title: book.title,
        source,
        description,
        fetchedAt: new Date().toISOString(),
      };

      if (!dryRun) {
        await pool.query(`UPDATE books SET description = $2 WHERE id = $1`, [
          book.id,
          description,
        ]);
      }

      updated += 1;
      saveCache(cache);
    } catch (error) {
      failed += 1;
      console.warn(`  ✗ ${error.message}`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`Готово. Обновлено: ${updated}, пропущено (кэш): ${skipped}, ошибок: ${failed}`);
  console.log(`Кэш: ${CACHE_PATH}`);
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
