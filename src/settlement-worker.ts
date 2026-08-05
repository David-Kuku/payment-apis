import { pool } from "./db.js";
import { logger } from "./logger.js";
import { payoutService } from "./payouts/payout.service.js";

/**
 * The settlement worker: a SCHEDULED (batch) worker, unlike the event-driven
 * webhook worker. Every tick it:
 *   1. SWEEP  — debit settleable wallets and create 'pending' payouts.
 *   2. PROCESS — send due 'pending' payouts to the bank; mark paid, or retry,
 *      or (retries exhausted) reverse the debit and mark failed.
 *
 * Conceptually this runs once a day; here it ticks every SETTLEMENT_INTERVAL_MS
 * so you can watch it work.
 */
const SETTLEMENT_INTERVAL_MS = Number(process.env.SETTLEMENT_INTERVAL_MS ?? "15000");
const PROCESS_BATCH = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tick(): Promise<void> {
  await payoutService.sweep(); // global — all merchants
  await payoutService.processDuePayouts(PROCESS_BATCH);
}

async function main() {
  logger.info("💸 settlement worker started");

  let running = true;
  const stop = async () => {
    running = false;
    await pool.end().catch(() => {});
    logger.info("settlement worker stopped");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (running) {
    try {
      await tick();
    } catch (err) {
      logger.error({ err }, "settlement tick failed");
    }
    await sleep(SETTLEMENT_INTERVAL_MS);
  }
}

main().catch((err) => {
  logger.error({ err }, "settlement worker crashed");
  process.exit(1);
});
