import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../errors.js";

/**
 * Build a middleware that validates req.body against a zod schema (a DTO).
 *
 * On success: overwrites req.body with the PARSED data (types coerced, unknown
 *   fields stripped) and continues.
 * On failure: throws ValidationError. Because this middleware is synchronous,
 *   Express catches the throw automatically and routes it to the error handler.
 *
 * This pulls validation OUT of controllers entirely — they can now trust
 * req.body is already valid.
 */
export const validateBody =
  (schema: ZodType): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError(result.error.flatten().fieldErrors);
    }
    req.body = result.data;
    next();
  };
