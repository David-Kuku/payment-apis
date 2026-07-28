import { beforeEach, afterAll } from "vitest";
import { withDatabase } from "./db-url.js";

/**
 * Point the app at the TEST database BEFORE anything imports db.ts.
 *
 * This runs as a Vitest setupFile, which executes before each test file's own
 * imports — so when the test file (transitively) imports db.ts, the pool is
 * created against payment_test, not the dev database. We do NOT statically
 * import db.ts here (that would create the pool too early); we import it lazily
 * inside the hooks below.
 */
const base =
  process.env.DATABASE_URL ?? "postgres://payment:payment@postgres:5432/payment";
process.env.DATABASE_URL = withDatabase(base, "payment_test");
process.env.NODE_ENV = "test";

// All data tables, child-before-parent order (CASCADE handles FKs anyway).
const TABLES = [
  "idempotency_keys",
  "webhook_events",
  "webhook_endpoints",
  "charges",
  "payment_intents",
  "ledger_entries",
  "transactions",
  "wallets",
  "merchants",
];

// Start every test from a clean database.
beforeEach(async () => {
  const { pool } = await import("../db.js");
  await pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  const { pool } = await import("../db.js");
  await pool.end();
});
