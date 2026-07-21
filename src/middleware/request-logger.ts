import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { logger } from "../logger.js";

/**
 * Request-logging middleware. For every incoming request it:
 *   1. Generates a unique correlation id (req.id).
 *   2. Attaches a CHILD logger (req.log) pre-tagged with that id — so every log
 *      line produced while handling this request carries the same reqId, and
 *      you can filter your logs down to a single request's whole story.
 *   3. Logs when the request arrives, and again when the response finishes,
 *      including the status code and how long it took.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  req.id = requestId;
  req.log = logger.child({ reqId: requestId });

  // High-resolution start time so we can measure duration accurately.
  const start = process.hrtime.bigint();

  req.log.info({ method: req.method, url: req.url }, "request received");

  // res.on("finish") fires once the response has been fully sent.
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    req.log.info(
      {
        method: req.method,
        url: req.url,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
      },
      "request completed"
    );
  });

  next();
};
