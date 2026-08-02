// ── OpenTelemetry tracing ─────────────────────────────────────────────────────
// This file MUST be imported before any other code (see index.ts's first line).
// Why: the auto-instrumentations work by PATCHING libraries (http, express, pg)
// as they load. If express/pg were imported before the SDK starts, there'd be
// nothing to patch and no spans. First-in wins.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

// Where to ship finished spans. Jaeger exposes an OTLP/HTTP receiver on 4318;
// on the Docker network it's reachable at http://jaeger:4318.
const otlpBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: `${otlpBase}/v1/traces` }),
  // getNodeAutoInstrumentations wires up http, express, pg, amqplib, and more —
  // each emits spans automatically. We disable fs: it fires on every file read
  // and drowns the trace in noise.
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
  // service.name comes from the OTEL_SERVICE_NAME env var (set per process in
  // docker-compose) — it's how Jaeger labels which service a span came from.
});

sdk.start();

// Flush any buffered spans on shutdown so we don't lose the last few.
process.on("SIGTERM", () => {
  sdk.shutdown().finally(() => process.exit(0));
});
