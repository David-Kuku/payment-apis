import { z } from "zod";

/**
 * The currencies we actually support. Keeping this as one exported constant
 * means the allowlist lives in exactly one place — the validation schema and
 * any future checks all read from it.
 */
export const SUPPORTED_CURRENCIES = ["NGN", "USD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

// ── Input DTOs ───────────────────────────────────────────────────────────────

/** Input DTO for POST /wallets. z.enum rejects anything outside the allowlist. */
export const createWalletSchema = z.object({
  currency: z.enum(SUPPORTED_CURRENCIES),
});
export type CreateWalletDto = z.infer<typeof createWalletSchema>;

// ── Output DTOs ──────────────────────────────────────────────────────────────

/**
 * A wallet as we expose it. Note `balance` is a STRING, not a number:
 * node-postgres returns BIGINT columns as strings because a 64-bit integer can
 * exceed what a JS number can safely hold (2^53 - 1). Keeping it a string
 * preserves exactness. The value is in MINOR UNITS (kobo/cents) — e.g. "1500"
 * means ₦15.00.
 */
export interface PublicWallet {
  id: string;
  currency: string;
  balance: string;
  created_at: Date;
}
