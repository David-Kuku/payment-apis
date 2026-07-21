import type { RequestHandler } from "express";
import { verifyToken } from "../auth/jwt.js";
import { UnauthorizedError } from "../errors.js";

/**
 * The authentication gatekeeper.
 *
 * Put this in front of any route that requires a logged-in merchant. It:
 *   1. Reads the "Authorization: Bearer <token>" header.
 *   2. Verifies the JWT (signature + expiry) via verifyToken.
 *   3. Attaches the caller's identity to req.merchant for downstream handlers.
 *
 * On any failure it throws a domain error (401), so the request never reaches
 * the protected handler. This middleware is synchronous and throws, which
 * Express catches and routes to the global error handler automatically.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;

  // Expect exactly: "Bearer <token>"
  if (!header || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    throw new UnauthorizedError("Missing bearer token");
  }

  // verifyToken throws ExpiredTokenError / InvalidTokenError on bad tokens.
  const payload = verifyToken(token);

  // Attach identity. `sub` is the merchant id we put in at login.
  req.merchant = { id: payload.sub, email: payload.email };

  // Tag this request's logs with who made it — great for auditing.
  req.log = req.log.child({ merchantId: payload.sub });

  next();
};
