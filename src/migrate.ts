import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./db.js";

/**
 * A minimal migration runner.
 *
 * The strategy:
 *   1. Keep a `schema_migrations` table that records the filename of every
 *      migration we've already applied.
 *   2. Look at every .sql file in /migrations, sorted by name (0001, 0002...).
 *   3. Run any that aren't recorded yet — each inside a TRANSACTION so that if
 *      the SQL fails halfway, nothing is left half-applied.
 */

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations"
);

async function migrate() {
  // Step 1: make sure the bookkeeping table exists.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Which migrations have we already run?
  const { rows } = await pool.query("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  // All .sql files, in order.
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue; // already done — skip

    const sql = await readFile(path.join(migrationsDir, file), "utf8");

    // Grab a single dedicated connection so BEGIN/COMMIT stay together.
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); // start transaction
      await client.query(sql); // run the migration's SQL
      await client.query(
        "INSERT INTO schema_migrations (name) VALUES ($1)",
        [file]
      );
      await client.query("COMMIT"); // all-or-nothing: commit the whole thing
      console.log(`✅ applied ${file}`);
      ran++;
    } catch (err) {
      await client.query("ROLLBACK"); // failure → undo everything in this file
      console.error(`❌ failed ${file}`);
      throw err;
    } finally {
      client.release(); // give the connection back to the pool
    }
  }

  console.log(ran === 0 ? "Nothing to migrate — already up to date." : `Done. Ran ${ran} migration(s).`);
  await pool.end(); // close the pool so the script exits cleanly
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
