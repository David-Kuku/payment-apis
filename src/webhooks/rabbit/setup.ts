import { connectRabbit } from "./connection.js";
import { assertTopology } from "./topology.js";
import { logger } from "../../logger.js";

/**
 * One-shot: connect to RabbitMQ, declare the exchanges/queues/bindings, exit.
 * Run this once (it's idempotent) so the topology exists before the worker runs.
 */
async function main() {
  const { connection, channel } = await connectRabbit();
  await assertTopology(channel);
  logger.info("✅ RabbitMQ topology asserted (exchanges + queues + bindings)");
  await channel.close();
  await connection.close();
}

main().catch((err) => {
  logger.error({ err }, "rabbit setup failed");
  process.exit(1);
});
