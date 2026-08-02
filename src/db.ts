import { createRequire } from "node:module";
import type { Pool, PoolClient } from "pg";
import "dotenv/config"; // loads .env into process.env

// tsx's ESM loader bypasses the require() that OpenTelemetry hooks into, so a
// plain `import pg from "pg"` leaves pg's Client.query un-instrumented — you get
// pg-pool.connect spans but no pg.query spans. Loading pg through a real
// CommonJS require() routes it past OTel's hook so the query patch applies.
// (The `import type` above is erased at runtime — types only.) See src/tracing.ts.
const require = createRequire(import.meta.url);
const pg = require("pg") as typeof import("pg");

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

/**
 * Something that can run a query: either the pool (auto-commit, one statement at
 * a time) OR a single client that's inside a transaction. Repository methods
 * accept an Executor so the SAME method works both standalone and inside a
 * transaction.
 */
export type Executor = Pool | PoolClient;

/**
 * Run `fn` inside a single database transaction.
 *
 * It grabs one dedicated connection, issues BEGIN, runs your callback (passing
 * the client so every query inside uses the SAME connection), then COMMITs. If
 * your callback throws, it ROLLBACKs — so the whole unit of work is
 * all-or-nothing. The connection is always returned to the pool at the end.
 *
 * Crucially: any row locks taken with SELECT ... FOR UPDATE are held until this
 * transaction COMMITs or ROLLBACKs.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
