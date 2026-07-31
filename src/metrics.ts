import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";
import { pool } from "./db.js";

/**
 * All metrics register here. Prometheus scrapes /metrics, which renders this
 * registry as text. One registry = one place that knows every metric.
 */
export const registry = new Registry();

// Default Node/process metrics: event-loop lag, heap/memory, GC, open handles.
// Free operational insight into the process itself.
collectDefaultMetrics({ register: registry });

// ── RED: Rate + Errors (a counter) ───────────────────────────────────────────
// Rate = increase over time; Errors = filter by status_code. Labels are LOW
// cardinality on purpose: method (handful), route PATTERN (bounded), status.
export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [registry],
});

// ── RED: Duration (a histogram) ──────────────────────────────────────────────
// Buckets let Prometheus compute p50/p95/p99. Chosen to straddle our <200ms
// latency goal so we can actually see when we breach it.
export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// ── A little business ─────────────────────────────────────────────────────────
export const transfersCompletedTotal = new Counter({
  name: "transfers_completed_total",
  help: "Total successful transfers",
  registers: [registry],
});

export const paymentIntentsTotal = new Counter({
  name: "payment_intents_total",
  help: "Payment intent lifecycle events",
  labelNames: ["event"], // created | confirmed | canceled
  registers: [registry],
});

// ── USE: the DB connection pool (a resource we contend for) ───────────────────
// A GAUGE (goes up/down) with a `collect` callback that reads the live pool
// numbers at SCRAPE time — so Prometheus always sees the current state:
//   total   = connections the pool has open        (Utilization)
//   idle    = open connections sitting unused
//   waiting = requests QUEUED for a free connection (Saturation — the key one)
export const dbPoolConnections = new Gauge({
  name: "db_pool_connections",
  help: "Postgres connection pool state",
  labelNames: ["state"],
  registers: [registry],
  collect() {
    this.set({ state: "total" }, pool.totalCount);
    this.set({ state: "idle" }, pool.idleCount);
    this.set({ state: "waiting" }, pool.waitingCount);
  },
});
