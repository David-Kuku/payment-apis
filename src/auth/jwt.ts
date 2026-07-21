import jwt from "jsonwebtoken";
import "dotenv/config";
import { InvalidTokenError, ExpiredTokenError } from "../errors.js";

/**
 * All JWT logic lives here. The rest of the app just calls signToken /
 * verifyToken and never touches the library or the secret directly.
 */

const secret = process.env.JWT_SECRET;
if (!secret) {
  // Fail fast at startup rather than mysteriously later. A missing signing
  // secret is a fatal misconfiguration.
  throw new Error("JWT_SECRET is not set. Add it to your .env file.");
}

/** How long a token stays valid. Short-lived tokens limit damage if stolen. */
const EXPIRES_IN = "1h";

/**
 * The claims WE put into the token. `sub` (subject) is the standard place for
 * "who this token identifies" — here, the merchant's id.
 */
export interface AuthTokenPayload {
  sub: string; // merchant id
  email: string;
}

/** Create a signed token for a merchant. */
export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, secret!, { expiresIn: EXPIRES_IN });
}

/**
 * Verify a token's signature + expiry and return its claims.
 * Throws if the token is invalid, tampered with, or expired — the caller
 * decides how to react to that.
 */
export function verifyToken(token: string): AuthTokenPayload {
  try {
    // jwt.verify checks the signature AND expiry; throws if either fails.
    const decoded = jwt.verify(token, secret!) as jwt.JwtPayload;
    return { sub: decoded.sub as string, email: decoded.email as string };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new ExpiredTokenError();
    }
    throw new InvalidTokenError();
  }
}
