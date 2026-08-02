import { context, propagation } from "@opentelemetry/api";
import type { Channel, ConfirmChannel } from "amqplib";
import { pool } from "./db.js";
import { logger } from "./logger.js";
import { connectRabbit } from "./webhooks/rabbit/connection.js";
import {
  assertTopology,
  EXCHANGE,
  EXCHANGE_RETRY,
  EXCHANGE_DEAD,
  ROUTING_KEY,
  Q_DELIVER,
} from "./webhooks/rabbit/topology.js";
import { webhookEventRepository } from "./webhooks/webhook-event.repository.js";
import { webhookEndpointRepository } from "./webhooks/webhook-endpoint.repository.js";
import { signPayload } from "./webhooks/webhook-signing.js";

/**
 * RabbitMQ-based webhook worker. Two jobs in one process:
 *
 *  1. RELAY (three-phase, reliable): claim pending outbox events into a
 *     'publishing' state → publish them to the broker on a CONFIRM channel,
 *     OUTSIDE any DB transaction → only once the broker confirms, mark them
 *     'published'. A reaper rescues rows left in 'publishing' by a crash.
 *
 *  2. CONSUMER: subscribe to the main queue, POST each webhook, and ack /
 *     retry-with-backoff / dead-letter.
 */

const RELAY_INTERVAL_MS = 1000;
const RELAY_BATCH = 20;
const PREFETCH = 10;
const MAX_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 10_000;
const PUBLISHING_STALE_SECONDS = 30; // how long before a stuck 'publishing' row is reaped

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt: number) => Math.min(5000 * 2 ** (attempt - 1), 300_000);

// ── Relay ────────────────────────────────────────────────────────────────────
async function relayTick(pubChannel: ConfirmChannel): Promise<void> {
  // Phase 0 — reaper: rescue rows a crashed relay left in 'publishing'.
  const reaped = await webhookEventRepository.reapStalePublishing(PUBLISHING_STALE_SECONDS);
  if (reaped > 0) {
    logger.warn(`reaped ${reaped} stale publishing event(s) back to pending`);
  }

  // Phase 1 — claim: atomically flip pending -> publishing (no lock held after).
  const rows = await webhookEventRepository.claimForPublishing(RELAY_BATCH);
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);

  try {
    // Phase 2 — publish on the confirm channel (NO DB transaction open here).
    for (const row of rows) {
      const message = {
        outboxId: row.id,
        endpointId: row.endpoint_id,
        eventType: row.event_type,
        payload: row.payload,
      };
      // Resume the trace that started in the API when this event was enqueued.
      // extract() turns the stored carrier back into a context; publishing WITHIN
      // it makes amqplib's producer span a child of the original request AND
      // injects traceparent into the message headers — so the consumer and its
      // delivery fetch join the very same trace.
      const parentCtx = row.trace_context
        ? propagation.extract(context.active(), row.trace_context)
        : context.active();
      context.with(parentCtx, () => {
        pubChannel.publish(EXCHANGE, ROUTING_KEY, Buffer.from(JSON.stringify(message)), {
          persistent: true,
          headers: { "x-attempts": 1 },
        });
      });
    }
    // Wait for the broker to ACK every message before we mark anything published.
    await pubChannel.waitForConfirms();

    // Phase 3 — now it's safe to mark them published.
    await webhookEventRepository.markPublished(ids);
    logger.info(`relayed ${ids.length} event(s) to RabbitMQ (confirmed)`);
  } catch (err) {
    // Broker nacked or the connection dropped → nothing is guaranteed delivered.
    // Put the batch back to pending immediately (the reaper is the backstop if
    // we crash before this runs).
    await webhookEventRepository.resetToPending(ids);
    logger.warn({ err }, "relay publish not confirmed — reset batch to pending");
  }
}

// ── Consumer ─────────────────────────────────────────────────────────────────
async function startConsumer(channel: Channel): Promise<void> {
  await channel.prefetch(PREFETCH);

  await channel.consume(Q_DELIVER, async (msg) => {
    if (!msg) return;

    try {
      const data = JSON.parse(msg.content.toString()) as {
        outboxId: string;
        endpointId: string;
        eventType: string;
        payload: unknown;
      };
      const attempt = Number(msg.properties.headers?.["x-attempts"] ?? 1);

      const endpoint = await webhookEndpointRepository.findById(data.endpointId);
      if (!endpoint) {
        channel.publish(EXCHANGE_DEAD, ROUTING_KEY, msg.content, { persistent: true });
        await webhookEventRepository.markFailed(data.outboxId, attempt, "endpoint deleted");
        channel.ack(msg);
        return;
      }

      const body = JSON.stringify(data.payload);
      const signature = signPayload(endpoint.secret, body);

      try {
        const res = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Event": data.eventType,
            "X-Webhook-Signature": signature,
          },
          body,
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });

        if (res.ok) {
          await webhookEventRepository.markDelivered(data.outboxId);
          logger.info({ outboxId: data.outboxId, url: endpoint.url }, "webhook delivered (rabbit)");
          channel.ack(msg);
          return;
        }
        throw new Error(`non-2xx response: ${res.status}`);
      } catch (err: any) {
        const message = String(err?.message ?? "delivery failed");
        if (attempt >= MAX_ATTEMPTS) {
          channel.publish(EXCHANGE_DEAD, ROUTING_KEY, msg.content, {
            persistent: true,
            headers: { "x-attempts": attempt },
          });
          await webhookEventRepository.markFailed(data.outboxId, attempt, message);
          logger.warn({ outboxId: data.outboxId, attempt }, "webhook dead-lettered (rabbit)");
        } else {
          channel.publish(EXCHANGE_RETRY, ROUTING_KEY, msg.content, {
            persistent: true,
            headers: { "x-attempts": attempt + 1 },
            expiration: String(backoffMs(attempt)),
          });
          logger.warn(
            { outboxId: data.outboxId, attempt, retryInMs: backoffMs(attempt), err: message },
            "webhook failed — scheduled retry (rabbit)",
          );
        }
        channel.ack(msg);
      }
    } catch (err) {
      logger.error({ err }, "consumer handler error; discarding message");
      channel.nack(msg, false, false);
    }
  });

  logger.info("🐰 rabbit consumer listening on " + Q_DELIVER);
}

async function main() {
  const { connection, channel } = await connectRabbit();
  await assertTopology(channel); // idempotent

  // A CONFIRM channel for the relay: publishes here are acknowledged by the
  // broker, so waitForConfirms() tells us the message is safely stored.
  const pubChannel = await connection.createConfirmChannel();

  logger.info("🐰 rabbit worker started");
  await startConsumer(channel);

  let running = true;
  const stop = async () => {
    running = false;
    await pubChannel.close().catch(() => {});
    await channel.close().catch(() => {});
    await connection.close().catch(() => {});
    await pool.end().catch(() => {});
    logger.info("rabbit worker stopped");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (running) {
    try {
      await relayTick(pubChannel);
    } catch (err) {
      logger.error({ err }, "relay tick failed");
    }
    await sleep(RELAY_INTERVAL_MS);
  }
}

main().catch((err) => {
  logger.error({ err }, "rabbit worker crashed");
  process.exit(1);
});
