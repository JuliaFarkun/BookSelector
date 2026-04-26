const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to run the server.");
}

const ssl =
  process.env.PGSSL_DISABLE === "true"
    ? false
    : { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === "true" };

const pool = new Pool({
  connectionString,
  ssl,
});

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  withTransaction,
};
