/**
 * Читает книги из БД или booksmatch_bd.sql, тянет аннотации в data/book-descriptions.json
 *
 * node scripts/fetch-descriptions-to-cache.js
 * node scripts/fetch-descriptions-to-cache.js --missing
 * node scripts/fetch-descriptions-to-cache.js --force
 */
require("dotenv").config({ override: true });
const fs = require("fs");
const path = require("path");
const { fetchBookDescription } = require("./litres-description");

const DUMP_PATH = path.join(__dirname, "../booksmatch_bd.sql");
const CACHE_PATH = path.join(__dirname, "../data/book-descriptions.json");
const DELAY_MS = Number(process.env.LITRES_FETCH_DELAY_MS) || 1400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseAuthorsFromDump(dump) {
  const normalized = dump.replace(/\r\n/g, "\n");
  const startMarker = "COPY public.authors (id, name) FROM stdin;\n";
  const endMarker =
    "\n\\.\n\n\n--\n-- TOC entry 5012 (class 0 OID 41543)\n-- Dependencies: 225\n-- Data for Name: book_tags; Type: TABLE DATA; Schema: public; Owner: postgres";
  const start = normalized.indexOf(startMarker);
  const end = normalized.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    throw new Error("Не удалось найти блок authors в booksmatch_bd.sql");
  }
  const body = normalized.slice(start + startMarker.length, end);
  const byId = new Map();
  for (const line of body.split("\n")) {
    if (!line.trim() || !/^\d+\t/.test(line)) continue;
    const parts = line.split("\t");
    if (parts.length !== 2) continue;
    const id = Number(parts[0]);
    if (!Number.isFinite(id)) continue;
    byId.set(id, parts[1]);
  }
  return byId;
}

function parseBooksFromDump() {
  const dump = fs.readFileSync(DUMP_PATH, "utf8").replace(/\r\n/g, "\n");
  const authors = parseAuthorsFromDump(dump);
  const startMarker =
    "COPY public.books (id, title, author_id, description, cover_url, download_url, created_at) FROM stdin;\n";
  const endMarker =
    "\n\\.\n\n\n--\n-- TOC entry 5010 (class 0 OID 41515)\n-- Dependencies: 223\n-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: postgres";
  const start = dump.indexOf(startMarker);
  const end = dump.indexOf(endMarker, start);
  const body = dump.slice(start + startMarker.length, end);

  return body
    .split("\n")
    .filter((line) => line.trim() && /^\d+\t/.test(line))
    .map((line) => {
      const parts = line.split("\t");
      return {
        id: Number(parts[0]),
        title: parts[1],
        author: authors.get(Number(parts[2])) || "",
        downloadUrl: parts[5],
      };
    })
    .filter((book) => book.downloadUrl?.includes("litres.ru"));
}

async function loadBooksFromDb() {
  const { pool } = require("../db/pool");
  const { rows } = await pool.query(
    `SELECT b.id, b.title, a.name AS author, b.download_url
     FROM books b
     JOIN authors a ON a.id = b.author_id
     ORDER BY b.id ASC`
  );
  await pool.end();
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    author: row.author,
    downloadUrl: row.download_url || "",
  }));
}

async function loadBooks() {
  if (process.env.DATABASE_URL) {
    try {
      return await loadBooksFromDb();
    } catch (error) {
      console.warn("БД недоступна, читаем из дампа:", error.message);
    }
  }
  return parseBooksFromDump();
}

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

async function main() {
  const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]) || 0;
  const force = process.argv.includes("--force");
  const missingOnly = process.argv.includes("--missing");
  const cache = loadCache();
  const books = await loadBooks();
  let targets = limit > 0 ? books.slice(0, limit) : books;

  if (missingOnly && !force) {
    targets = targets.filter((book) => !(cache[String(book.id)]?.description?.length >= 80));
  }

  console.log(`Всего книг: ${books.length}, обработаем: ${targets.length}`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const book of targets) {
    const cached = cache[String(book.id)];
    if (!force && cached?.description?.length >= 80) {
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
      updated += 1;
      saveCache(cache);
    } catch (error) {
      await sleep(2000);
      try {
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
        updated += 1;
        saveCache(cache);
        console.log(`  ↻ повтор: ок`);
      } catch (retryError) {
        failed += 1;
        console.warn(`  ✗ ${error.message}`);
      }
    }

    await sleep(DELAY_MS);
  }

  console.log(`Готово. Загружено: ${updated}, пропущено: ${skipped}, ошибок: ${failed}`);
  const good = Object.values(cache).filter((e) => e?.description?.length >= 80).length;
  console.log(`В кэше описаний: ${good} / ${books.length}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { parseAuthorsFromDump, parseBooksFromDump, loadCache, saveCache };
