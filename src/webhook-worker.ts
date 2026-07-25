import { pool } from "./db.js";
import { logger } from "./logger.js";
import {
  webhookEventRepository,
  type WebhookEventRow,
} from "./webhooks/webhook-event.repository.js";
import { webhookEndpointRepository } from "./webhooks/webhook-endpoint.repository.js";
import { signPayload } from "./webhooks/webhook-signing.js";

/**
 * The WEBHOOK WORKER: a separate process that drains the outbox.
 *
 * Loop: claim due events (SKIP LOCKED) → POST each to its endpoint (signed) →
 * mark delivered, or schedule a retry with exponential backoff, or dead-letter
 * after MAX_ATTEMPTS. It shares the database with the API but runs on its own,
 * which is the whole point: delivery is decoupled from the request that emitted
 * the event.
 */

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Exponential backoff: 5s, 10s, 20s, 40s, ... capped at 5 minutes.
const backoffSeconds = (attempt: number) =>
  Math.min(5 * 2 ** (attempt - 1), 300);

async function deliverOne(event: WebhookEventRow): Promise<void> {
  const attempt = event.attempts + 1;

  const endpoint = await webhookEndpointRepository.findById(event.endpoint_id);
  if (!endpoint) {
    await webhookEventRepository.markFailed(event.id, attempt, "endpoint deleted");
    return;
  }

  const body = JSON.stringify(event.payload);
  const signature = signPayload(endpoint.secret, body);

  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": event.event_type,
        "X-Webhook-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    if (res.ok) {
      await webhookEventRepository.markDelivered(event.id);
      logger.info({ eventId: event.id, url: endpoint.url }, "webhook delivered");
      return;
    }
    throw new Error(`non-2xx response: ${res.status}`);
  } catch (err: any) {
    const message = String(err?.message ?? "delivery failed");
    if (attempt >= MAX_ATTEMPTS) {
      await webhookEventRepository.markFailed(event.id, attempt, message);
      logger.warn(
        { eventId: event.id, attempt, err: message },
        "webhook dead-lettered (max attempts reached)",
      );
    } else {
      const backoff = backoffSeconds(attempt);
      await webhookEventRepository.markRetry(event.id, attempt, backoff, message);
      logger.warn(
        { eventId: event.id, attempt, retryInSeconds: backoff, err: message },
        "webhook delivery failed — will retry",
      );
    }
  }
}

async function tick(): Promise<void> {
  const events = await webhookEventRepository.claimDue(BATCH_SIZE);
  if (events.length > 0) {
    logger.info(`claimed ${events.length} webhook event(s)`);
    // Deliver the batch concurrently.
    await Promise.all(events.map(deliverOne));
  }
}

async function main() {
  logger.info("🪝 webhook worker started");

  let running = true;
  const stop = () => {
    running = false;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (running) {
    try {
      await tick();
    } catch (err) {
      logger.error({ err }, "worker tick failed");
    }
    await sleep(POLL_INTERVAL_MS);
  }

  await pool.end();
  logger.info("webhook worker stopped");
}

main().catch((err) => {
  logger.error({ err }, "worker crashed");
  process.exit(1);
});
