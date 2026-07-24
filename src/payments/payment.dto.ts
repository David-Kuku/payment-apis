import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "../wallets/wallet.dto.js";

// ── Input DTO ────────────────────────────────────────────────────────────────

export const createPaymentIntentSchema = z.object({
  amount: z.number().int().positive(), // minor units
  currency: z.enum(SUPPORTED_CURRENCIES),
  customerReference: z.string().max(255).optional(),
});
export type CreatePaymentIntentDto = z.infer<typeof createPaymentIntentSchema>;

// ── The state machine's states ───────────────────────────────────────────────

export type PaymentIntentStatus =
  | "requires_confirmation"
  | "succeeded"
  | "canceled";

// ── Output DTOs ──────────────────────────────────────────────────────────────

export interface PublicPaymentIntent {
  id: string;
  amount: string; // BIGINT → string
  currency: string;
  status: PaymentIntentStatus;
  customerReference: string | null;
  created_at: Date;
}

export interface PublicCharge {
  id: string;
  paymentIntentId: string;
  amount: string;
  currency: string;
  transactionId: string;
  created_at: Date;
}
