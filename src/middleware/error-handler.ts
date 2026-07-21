import type { ErrorRequestHandler } from "express";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";

/**
 * The GLOBAL ERROR HANDLER.
 *
 * Express recognizes a middleware with FOUR arguments (err, req, res, next) as
 * an error handler. Whenever any route throws or calls next(err), Express jumps
 * straight here, skipping all normal middleware.
 *
 * Two cases:
 *  - A known AppError → respond with its own statusCode + code (+ details).
 *  - Anything else (a bug, a DB outage) → log it and return a generic 500, so
 *    we never leak internal stack traces to clients.
 *
 * IMPORTANT: this must be registered with app.use() AFTER all routes.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // req.log is the child logger tagged with this request's correlation id.
  // (Fall back to the base logger just in case an error somehow occurs before
  // the request-logger middleware ran.)
  const log = req.log ?? logger;

  if (err instanceof AppError) {
    // Expected errors are just part of normal operation — log at "warn", not
    // "error", so real bugs stand out from routine 4xx responses.
    log.warn({ code: err.code, statusCode: err.statusCode }, err.message);
    return res.status(err.statusCode).json({
      error: err.code, // stable, machine-readable — clients branch on this
      message: err.message, // human-readable — for developers/UI
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Unexpected errors are real problems — log the full error object at "error"
  // level so it shows up loudly, with the stack, tied to this request's id.
  log.error({ err }, "unexpected error");
  return res.status(500).json({
    error: "internal_error",
    message: "Something went wrong",
    requestId: req.id, // so a user can quote this and we find their exact logs
  });
};
