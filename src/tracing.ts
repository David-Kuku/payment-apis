// ── OpenTelemetry tracing ─────────────────────────────────────────────────────
// This file MUST be imported before any other code (see index.ts's first line).
// Why: the auto-instrumentations work by PATCHING libraries (http, express, pg)
// as they load. If express/pg were imported before the SDK starts, there'd be
// nothing to patch and no spans. First-in wins.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";

// Where to ship finished spans. Jaeger exposes an OTLP/HTTP receiver on 4318;
// on the Docker network it's reachable at http://jaeger:4318.
const otlpBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

// Fraction of traces to record. 1 = 100% (dev default — see everything). In prod,
// set OTEL_TRACES_SAMPLE_RATIO=0.05 to keep ~5% and cut trace CPU/bandwidth/
// storage cost by ~95%, since almost every trace is a boring happy-path request.
const sampleRatio = Number(process.env.OTEL_TRACES_SAMPLE_RATIO ?? "1");

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: `${otlpBase}/v1/traces` }),
  // ParentBased: honour the caller's sampling decision so a distributed trace is
  // all-or-nothing across services (API → worker → …). Only the ROOT span rolls
  // the dice, using the ratio; downstream spans inherit it via traceparent.
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(sampleRatio),
  }),
  // getNodeAutoInstrumentations wires up http, express, pg, amqplib, and more —
  // each emits spans automatically. We disable the noisy ones: fs (every file
  // read) and net/dns (a dns.lookup + tcp.connect span per new connection).
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-net": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
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
