import pg from "pg";
import "dotenv/config"; // loads .env into process.env

/**
 * A connection POOL, not a single connection.
 *
 * Opening a new DB connection for every request is slow. Instead, `pg` keeps a
 * small set of open connections ready and hands them out as requests come in,
 * then takes them back. This is essential for handling many requests at once.
 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * A tiny helper so the rest of the app can run a query without touching the pool
 * directly. Example:
 *   const result = await query("SELECT * FROM merchants WHERE id = $1", [id]);
 *
 * Note the `$1` — that's a PARAMETERIZED query. We NEVER build SQL by gluing
 * strings together, because that opens the door to SQL injection attacks.
 * The `params` are sent separately and the database treats them as pure data.
 */
export function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}
