import pg from "pg";
import "dotenv/config";
import { withDatabase } from "./db-url.js";
import { runMigrations } from "../migrate.js";

/**
 * Prepare the test database (runs automatically before `npm test` via pretest):
 *   1. CREATE DATABASE payment_test (idempotent).
 *   2. Run all migrations against it.
 * Derives URLs from DATABASE_URL so it works both in the container and on host.
 */

const base =
  process.env.DATABASE_URL ?? "postgres://payment:payment@postgres:5432/payment";
const maintenanceUrl = withDatabase(base, "postgres");
const testUrl = withDatabase(base, "payment_test");

async function main() {
  // Create the test DB (connect to the maintenance "postgres" database to do it).
  const admin = new pg.Pool({ connectionString: maintenanceUrl });
  try {
    await admin.query("CREATE DATABASE payment_test");
    console.log("created database payment_test");
  } catch (err: any) {
    if (err?.code === "42P04") {
      console.log("payment_test already exists");
    } else {
      throw err;
    }
  } finally {
    await admin.end();
  }

  // Migrate the test DB.
  const testPool = new pg.Pool({ connectionString: testUrl });
  await runMigrations(testPool);
  await testPool.end();
  console.log("✅ test database ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
