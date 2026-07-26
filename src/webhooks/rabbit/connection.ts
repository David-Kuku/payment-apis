import amqp from "amqplib";
import "dotenv/config";

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
