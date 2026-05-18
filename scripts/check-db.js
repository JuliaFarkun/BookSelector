require("dotenv").config();
const { pool } = require("../db/pool");

async function main() {
  console.log("DATABASE_URL:", process.env.DATABASE_URL);
  const db = await pool.query("SELECT current_database() AS name");
  console.log("connected to:", db.rows[0].name);
  const tables = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  console.log("tables:", tables.rows.map((r) => r.tablename).join(", "));
  try {
    const books = await pool.query("SELECT COUNT(*)::int AS n FROM books");
    console.log("books count:", books.rows[0].n);
  } catch (e) {
    console.log("books error:", e.message);
  }
  await pool.end();
}

main();
