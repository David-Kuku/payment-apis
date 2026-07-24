import type { Executor } from "../db.js";

export interface ChargeRow {
  id: string;
  payment_intent_id: string;
  merchant_id: string;
  amount: string;
  currency: string;
  transaction_id: string;
  created_at: Date;
}

export const chargeRepository = {
  /** Create the charge row that records a succeeded payment. */
  async insert(
    exec: Executor,
    input: {
      paymentIntentId: string;
      merchantId: string;
      amount: string;
      currency: string;
      transactionId: string;
    },
  ): Promise<ChargeRow> {
    const result = await exec.query(
      `INSERT INTO charges (payment_intent_id, merchant_id, amount, currency, transaction_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, payment_intent_id, merchant_id, amount, currency, transaction_id, created_at`,
      [
        input.paymentIntentId,
        input.merchantId,
        input.amount,
        input.currency,
        input.transactionId,
      ],
    );
    return result.rows[0];
  },
};
