require("dotenv").config({ override: true });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const ADMIN_URL =
  process.env.PG_ADMIN_URL || "postgresql://postgres:postgres@localhost:5432/postgres";
const TARGET_DB = process.env.PG_DATABASE || "bookmatch";
const TARGET_URL = `postgresql://postgres:postgres@localhost:5432/${TARGET_DB}`;

async function ensureDatabase(adminPool) {
  const exists = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    TARGET_DB,
  ]);
  if (exists.rowCount) {
    console.log(`База «${TARGET_DB}» уже существует.`);
    return;
  }
  await adminPool.query(`CREATE DATABASE ${TARGET_DB}`);
  console.log(`Создана база «${TARGET_DB}».`);
}

async function hasBooks(pool) {
  try {
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'books'"
    );
    if (!rows[0]?.n) return false;
    const count = await pool.query("SELECT COUNT(*)::int AS n FROM books");
    return Number(count.rows[0].n) > 0;
  } catch {
    return false;
  }
}

async function importDumpIfNeeded(pool) {
  const populated = await hasBooks(pool);
  if (populated) {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM books");
    console.log(`В базе уже есть книги: ${rows[0].n}`);
    return;
  }

  const dumpPath = path.join(__dirname, "../booksmatch_bd.sql");
  if (!fs.existsSync(dumpPath)) {
    throw new Error("Не найден booksmatch_bd.sql для импорта.");
  }

  console.log("Импорт booksmatch_bd.sql (это может занять 1–2 минуты)…");
  const sql = fs.readFileSync(dumpPath, "utf8");
  await pool.query(sql);
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM books");
  console.log(`Импорт завершён. Книг в базе: ${rows[0].n}`);
}

async function writeEnvFile() {
  const envPath = path.join(__dirname, "../.env");
  const content = `DATABASE_URL=${TARGET_URL}
PGSSL_DISABLE=true
PORT=3780
`;
  fs.writeFileSync(envPath, content, "utf8");
  console.log("Создан файл .env");
}

async function main() {
  const adminPool = new Pool({ connectionString: ADMIN_URL, ssl: false });
  await ensureDatabase(adminPool);
  await adminPool.end();

  const pool = new Pool({ connectionString: TARGET_URL, ssl: false });
  await importDumpIfNeeded(pool);
  await pool.end();

  await writeEnvFile();
  console.log(`\nГотово. Запускайте: npm start → http://localhost:3780`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
