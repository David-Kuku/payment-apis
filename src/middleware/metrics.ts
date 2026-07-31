import type { RequestHandler } from "express";
import { httpRequestsTotal, httpRequestDuration } from "../metrics.js";

// Don't record metrics for these (infra endpoints — noise, and /metrics would
// measure itself).
const SKIP = new Set(["/metrics", "/health"]);

/**
 * Records HTTP RED metrics for each request. On response finish it captures the
 * ROUTE PATTERN (e.g. "/payment-intents/:id"), not the raw URL — critical for
 * cardinality: labelling by the real path (with ids in it) would create a new
 * time series per id and blow up Prometheus.
 */
export const metricsMiddleware: RequestHandler = (req, res, next) => {
  if (SKIP.has(req.path)) return next();

  // startTimer returns a function that, when called, observes elapsed seconds.
  const endTimer = httpRequestDuration.startTimer();

  res.on("finish", () => {
    // req.route is set only AFTER routing — available here in the finish handler.
    // baseUrl is the router mount ("/payment-intents"); route.path is the sub-
    // path ("/:id"). Together they form the pattern. Unmatched routes → "unknown".
    const route = req.route ? `${req.baseUrl}${req.route.path}` : "unknown";
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    endTimer(labels); // observe the duration with the same labels
  });

  next();
};
