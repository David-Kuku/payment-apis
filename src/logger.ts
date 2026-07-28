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

  // BASE FIELDS — attached to every log line. Once the API and the two workers
  // all ship logs to one place, `service` is how you tell whose log is whose.
  base: {
    service: process.env.SERVICE_NAME ?? "payment-api",
    env: process.env.NODE_ENV ?? "development",
    ...(process.env.npm_package_version
      ? { version: process.env.npm_package_version }
      : {}),
  },

  // REDACTION — guarantees secrets/PII never reach the logs, by configuration
  // rather than by remembering not to log them. Anyone who accidentally logs a
  // password / auth header / secret gets "[Redacted]" instead of a leak.
  redact: [
    "password",
    "*.password",
    "password_hash",
    "*.password_hash",
    "secret",
    "*.secret",
    "token",
    "*.token",
    "req.headers.authorization",
    "headers.authorization",
    "req.headers.cookie",
  ],

  // SERIALIZERS — ensure Error objects passed as `err` are serialized WITH their
  // stack trace (the most useful part when debugging an unexpected error).
  serializers: {
    err: pino.stdSerializers.err,
  },

  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
      }
    : {}),
});
