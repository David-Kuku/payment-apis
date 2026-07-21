import bcrypt from "bcrypt";

/**
 * The "cost factor". Each +1 roughly DOUBLES the time to hash.
 * 10 is a sane default (~100ms). Higher = more secure but slower.
 */
const SALT_ROUNDS = 10;

/**
 * Turn a plaintext password into a hash we can safely store.
 * bcrypt.hash() generates a random salt internally and embeds it in the output,
 * so the returned string already contains everything needed to verify later.
 */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Check a plaintext password against a stored hash.
 * bcrypt reads the salt + cost out of `hash`, re-hashes `plain` the same way,
 * and compares. Returns true only if they match. We never decrypt anything.
 */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
