import type { Channel } from "amqplib";

/**
 * RabbitMQ topology for webhook delivery.
 *
 * Core RabbitMQ concepts:
 *  - EXCHANGE: where publishers send messages. It routes them to queues based on
 *    a routing key + bindings. (Publishers never target queues directly.)
 *  - QUEUE: where messages wait for a consumer.
 *  - BINDING: a rule linking an exchange to a queue for a routing key.
 *  - DEAD-LETTER EXCHANGE (DLX): where a message goes when it's rejected or
 *    EXPIRES. This is how we build retries and a dead-letter queue declaratively.
 *
 * The flow we're wiring:
 *
 *   publish ─▶ [webhooks] ──deliver──▶ (webhook.deliver)  ← consumer reads here
 *                  ▲                          │ on failure, republish to retry
 *                  │ (after TTL expires,      ▼
 *                  │  dead-letters back)  [webhooks.retry] ──▶ (webhook.retry)
 *                  └──────────────────────────┘   per-message TTL = backoff
 *
 *   after max attempts ─▶ [webhooks.dead] ──▶ (webhook.dead)   ← the DLQ
 */

export const EXCHANGE = "webhooks";
export const EXCHANGE_RETRY = "webhooks.retry";
export const EXCHANGE_DEAD = "webhooks.dead";
export const ROUTING_KEY = "deliver";

export const Q_DELIVER = "webhook.deliver";
export const Q_RETRY = "webhook.retry";
export const Q_DEAD = "webhook.dead";

/** Declare all exchanges, queues, and bindings. Idempotent — safe to re-run. */
export async function assertTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(EXCHANGE, "direct", { durable: true });
  await channel.assertExchange(EXCHANGE_RETRY, "direct", { durable: true });
  await channel.assertExchange(EXCHANGE_DEAD, "direct", { durable: true });

  // Main queue — the consumer reads from here.
  await channel.assertQueue(Q_DELIVER, { durable: true });
  await channel.bindQueue(Q_DELIVER, EXCHANGE, ROUTING_KEY);

  // Retry queue — a message sits here with a per-message TTL (the backoff delay).
  // When it expires, RabbitMQ dead-letters it BACK to the main exchange, so it
  // returns to the main queue for another attempt. No code runs the delay — the
  // broker does it.
  await channel.assertQueue(Q_RETRY, {
    durable: true,
    deadLetterExchange: EXCHANGE,
    deadLetterRoutingKey: ROUTING_KEY,
  });
  await channel.bindQueue(Q_RETRY, EXCHANGE_RETRY, ROUTING_KEY);

  // Dead-letter queue — the final resting place after retries are exhausted.
  await channel.assertQueue(Q_DEAD, { durable: true });
  await channel.bindQueue(Q_DEAD, EXCHANGE_DEAD, ROUTING_KEY);
}
