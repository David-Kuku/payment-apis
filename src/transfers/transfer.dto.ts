import { z } from "zod";

// ── Input DTO ────────────────────────────────────────────────────────────────

/**
 * Input DTO for POST /transfers.
 * - amount is a positive integer in MINOR units (kobo/cents).
 * - .refine enforces a cross-field rule: you can't transfer to the same wallet.
 */
export const createTransferSchema = z
  .object({
    fromWalletId: z.string().uuid(),
    toWalletId: z.string().uuid(),
    amount: z.number().int().positive(),
  })
  .refine((data) => data.fromWalletId !== data.toWalletId, {
    message: "fromWalletId and toWalletId must be different",
    path: ["toWalletId"],
  });
export type CreateTransferDto = z.infer<typeof createTransferSchema>;

// ── Output DTO ───────────────────────────────────────────────────────────────

export interface TransferResult {
  transactionId: string;
  fromWalletId: string;
  toWalletId: string;
  amount: number;
  currency: string;
}
