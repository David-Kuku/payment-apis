import type { RequestHandler } from "express";

/**
 * Express 4 automatically catches errors THROWN synchronously in a handler, but
 * NOT errors from an async function (a rejected Promise). Without this wrapper,
 * a `throw` inside an async controller would crash the process instead of
 * reaching our error handler.
 *
 * asyncHandler wraps a handler so any rejection is passed to next(err), which
 * routes it to the global error handler. Now controllers can freely `throw`.
 */
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
