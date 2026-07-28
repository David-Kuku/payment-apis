import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import pg from "pg";
import { pool } from "./db.js";

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

/**
 * Apply any un-applied migrations to the given pool. Extracted so both the CLI
 * (dev DB) and the test harness (test DB) can run migrations against different
 * databases.
 */
export async function runMigrations(targetPool: pg.Pool): Promise<void> {
  await targetPool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await targetPool.query("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const client = await targetPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`✅ applied ${file}`);
      ran++;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`❌ failed ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(
    ran === 0 ? "Nothing to migrate — already up to date." : `Done. Ran ${ran} migration(s).`,
  );
}

async function main() {
  await runMigrations(pool);
  await pool.end();
}

// Only run the CLI when this file is executed directly (not when imported, e.g.
// by the test harness which calls runMigrations against the test database).
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
