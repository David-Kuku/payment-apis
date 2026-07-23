import { pool } from "./db.js";
import { hashPassword } from "./auth/password.js";
import { logger } from "./logger.js";

/**
 * DEV-ONLY seed script. Creates two merchants (Alice & Bob), each with an NGN
 * wallet funded to ₦1,000 — and, crucially, funds them WITH matching ledger
 * entries so the invariant "balance = sum of the wallet's ledger" holds.
 *
 * It is IDEMPOTENT: run it as many times as you like. It uses ON CONFLICT to
 * avoid duplicate merchants/wallets, and only funds a wallet that has no ledger
 * history yet — so re-running never double-funds.
 *
 * Run with:  npm run seed:docker
 */

const SEED_PASSWORD = "password123"; // so you can log in as these merchants
const FUND_AMOUNT = 100_000; // ₦1,000 in kobo (minor units)

const seedMerchants = [{ email: "alice@seed.local" }, { email: "bob@seed.local" }];

async function seed() {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  // One connection, one transaction for the whole seed — all-or-nothing.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const { email } of seedMerchants) {
      // 1. Upsert the merchant. ON CONFLICT DO NOTHING makes re-runs safe.
      await client.query(
        `INSERT INTO merchants (email, password_hash)
         VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING`,
        [email, passwordHash],
      );
      const {
        rows: [merchant],
      } = await client.query(`SELECT id FROM merchants WHERE email = $1`, [email]);

      // 2. Upsert their NGN wallet.
      await client.query(
        `INSERT INTO wallets (merchant_id, currency)
         VALUES ($1, 'NGN')
         ON CONFLICT (merchant_id, currency) DO NOTHING`,
        [merchant.id],
      );
      const {
        rows: [wallet],
      } = await client.query(
        `SELECT id FROM wallets WHERE merchant_id = $1 AND currency = 'NGN'`,
        [merchant.id],
      );

      // 3. Fund it — but only if it has NO ledger history yet (idempotency).
      const {
        rows: [{ count }],
      } = await client.query(
        `SELECT COUNT(*)::int AS count FROM ledger_entries WHERE wallet_id = $1`,
        [wallet.id],
      );

      if (count === 0) {
        // A deposit is money entering from OUTSIDE the system. We record it as a
        // single credit entry. (Internal transfers, later, will always be
        // balanced debit+credit pairs; a deposit is the "money enters" exception
        // — a real system would debit an external/settlement account here.)
        const {
          rows: [txn],
        } = await client.query(
          `INSERT INTO transactions (type) VALUES ('deposit') RETURNING id`,
        );
        await client.query(
          `INSERT INTO ledger_entries (transaction_id, wallet_id, direction, amount, currency)
           VALUES ($1, $2, 'credit', $3, 'NGN')`,
          [txn.id, wallet.id, FUND_AMOUNT],
        );
        await client.query(
          `UPDATE wallets SET balance = balance + $1, updated_at = now() WHERE id = $2`,
          [FUND_AMOUNT, wallet.id],
        );
        logger.info(`funded ${email}'s NGN wallet with ${FUND_AMOUNT} kobo`);
      } else {
        logger.info(`${email}'s NGN wallet already funded — skipping`);
      }
    }

    await client.query("COMMIT");
    logger.info("✅ seed complete");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
}

seed().catch((err) => {
  logger.error({ err }, "seed failed");
  process.exit(1);
});
