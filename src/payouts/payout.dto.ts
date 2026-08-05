import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "../wallets/wallet.dto.js";

// ── Input DTO ────────────────────────────────────────────────────────────────

/** Register (or the merchant's) bank destination for a currency. */
export const registerPayoutAccountSchema = z.object({
  currency: z.enum(SUPPORTED_CURRENCIES),
  bankName: z.string().min(1).max(255),
  // Kept as a plain string for this learning app; a real system tokenizes this.
  accountNumber: z.string().min(6).max(34),
});
export type RegisterPayoutAccountDto = z.infer<
  typeof registerPayoutAccountSchema
>;

// ── Output DTOs ──────────────────────────────────────────────────────────────

export interface PublicPayoutAccount {
  id: string;
  currency: string;
  bankName: string;
  // Only the last 4 digits are ever returned — never the full number.
  accountLast4: string;
  isActive: boolean;
  created_at: Date;
}

export type PayoutStatus = "pending" | "paid" | "failed";

export interface PublicPayout {
  id: string;
  walletId: string;
  payoutAccountId: string;
  currency: string;
  amount: string; // BIGINT → string
  status: PayoutStatus;
  attempts: number;
  failureReason: string | null;
  created_at: Date;
}
