import { pool } from "./db.js";
import { logger } from "./logger.js";

/**
 * CONCURRENCY ATTACK (teaching tool).
 *
 * Fires many transfers at the SAME instant to expose the race condition in the
 * naïve transfer service. Run against the broken version → the books don't
 * balance. Run again after the fix → they do.
 */

const API = process.env.API_URL ?? "http://localhost:3000";
const CONCURRENCY = 30; // how many transfers to fire at once
const AMOUNT = 100; // kobo per transfer
const START = 100_000; // reset each wallet to this (₦1,000)

async function getWallet(email: string) {
  const { rows } = await pool.query(
    `SELECT w.id, w.balance
       FROM wallets w JOIN merchants m ON m.id = w.merchant_id
      WHERE m.email = $1 AND w.currency = 'USD'`,
    [email],
  );
  return rows[0] as { id: string; balance: string };
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as { token: string };
  return body.token;
}

async function main() {
  const alice = await getWallet("alice@seed.local");
  const bob = await getWallet("bob@seed.local");

  // Reset to a clean, known state (demo shortcut — sets balances directly).
  await pool.query(`UPDATE wallets SET balance = $1 WHERE id = ANY($2)`, [
    START,
    [alice.id, bob.id],
  ]);
  logger.info(`reset: Alice & Bob = ${START} kobo each (total ${2 * START})`);

  const token = await login("alice@seed.local", "password123");

  logger.info(
    `firing ${CONCURRENCY} concurrent transfers of ${AMOUNT} kobo, Alice -> Bob...`,
  );

  // The attack: build all requests, then fire them together with Promise.all so
  // they hit the server at the same time and interleave.
  const requests = Array.from({ length: CONCURRENCY }, () =>
    fetch(`${API}/transfers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fromWalletId: alice.id,
        toWalletId: bob.id,
        amount: AMOUNT,
      }),
    }),
  );
  const responses = await Promise.all(requests);
  const statuses = responses.map((r) => r.status);
  const successes = statuses.filter((s) => s === 201).length;
  const failures = statuses.length - successes;

  // Audit the books.
  const finalAlice = BigInt((await getWallet("alice@seed.local")).balance);
  const finalBob = BigInt((await getWallet("bob@seed.local")).balance);
  const total = finalAlice + finalBob;

  const expectedAlice = BigInt(START - successes * AMOUNT);
  const expectedBob = BigInt(START + successes * AMOUNT);
  const expectedTotal = BigInt(2 * START);

  // How many transfers actually show up in each balance?
  const appliedToAlice = (BigInt(START) - finalAlice) / BigInt(AMOUNT);
  const appliedToBob = (finalBob - BigInt(START)) / BigInt(AMOUNT);

  const supplyChange = total - expectedTotal;

  console.log("\n================ CONCURRENCY ATTACK REPORT ================");
  console.log(`transfers fired:        ${CONCURRENCY}`);
  console.log(`  succeeded (HTTP 201): ${successes}`);
  console.log(`  failed:               ${failures}`);
  console.log("-----------------------------------------------------------");
  console.log(`Alice  expected: ${expectedAlice}   actual: ${finalAlice}`);
  console.log(`Bob    expected: ${expectedBob}   actual: ${finalBob}`);
  console.log(`TOTAL  expected: ${expectedTotal}   actual: ${total}`);
  console.log("-----------------------------------------------------------");
  console.log(
    `${successes} transfers succeeded, but Alice's balance reflects only ${appliedToAlice}, Bob's only ${appliedToBob}.`,
  );
  if (
    finalAlice === expectedAlice &&
    finalBob === expectedBob &&
    supplyChange === 0n
  ) {
    console.log(
      "✅ Books balance. No money created or lost. Ledger is consistent.",
    );
  } else {
    console.log(
      `💥 CORRUPTION! Money supply changed by ${supplyChange} kobo ` +
        `(+ = created from nothing, - = destroyed).`,
    );
    console.log(
      "   The ledger recorded every transfer, but the balances don't match. " +
        "This is unaccountable money.",
    );
  }
  console.log("===========================================================\n");

  await pool.end();
}

main().catch((err) => {
  logger.error({ err }, "attack failed");
  process.exit(1);
});
