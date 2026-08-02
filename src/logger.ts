import pino from "pino";
import { trace } from "@opentelemetry/api";
import "dotenv/config";

/**
 * Runs on EVERY log call. It asks OpenTelemetry "what span is active right now?"
 * — which OTel tracks in AsyncLocalStorage (a per-request async context). If we're
 * inside a traced request, we stamp its trace_id/span_id onto the log line. This
 * is what LINKS logs to traces: copy a trace_id from a log and paste it into
 * Jaeger's "Lookup by Trace ID" to see the exact request the log came from.
 */
function otelMixin() {
  const span = trace.getActiveSpan();
  if (!span) return {}; // e.g. logs at startup, before any request
  const { traceId, spanId } = span.spanContext();
  return { trace_id: traceId, span_id: spanId };
}

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

  // Inject trace_id/span_id into every line (see otelMixin above).
  mixin: otelMixin,

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
