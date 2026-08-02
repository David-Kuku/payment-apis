import { createRequire } from "node:module";
import "dotenv/config";

// Same reason as src/db.ts: tsx's ESM loader hides a plain `import amqp from
// "amqplib"` from OpenTelemetry's require() hook, so amqplib wouldn't be
// instrumented — no publish/consume spans and, crucially, no automatic
// traceparent propagation through message headers. Loading it through a real
// CommonJS require() lets OTel patch it.
const require = createRequire(import.meta.url);
const amqp = require("amqplib") as typeof import("amqplib");

const url = process.env.RABBITMQ_URL ?? "amqp://payment:payment@localhost:5672";

/**
 * Open a connection + channel to RabbitMQ.
 *
 * - Connection: the TCP link to the broker.
 * - Channel: a lightweight virtual connection over it. Almost all operations
 *   (publish, consume, declare queues) happen on a channel, not the connection.
 */
export async function connectRabbit() {
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  return { connection, channel };
}
