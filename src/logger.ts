import pino from "pino";
import "dotenv/config";

/**
 * The application logger (pino).
 *
 * - In DEVELOPMENT: uses pino-pretty for colored, human-readable lines.
 * - In PRODUCTION: emits raw JSON — one object per line — which log systems
 *   (Loki, Datadog, CloudWatch) can index and search.
 *
 * `level` controls verbosity: debug < info < warn < error. Setting it to "warn"
 * in prod, say, hides all the info/debug noise without touching the code.
 */
const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
      }
    : {}),
});
