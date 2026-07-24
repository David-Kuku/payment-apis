import { pool, query, type Executor } from "../db.js";
import type { PaymentIntentStatus } from "./payment.dto.js";

export interface PaymentIntentRow {
  id: string;
  merchant_id: string;
  amount: string; // BIGINT
  currency: string;
  status: PaymentIntentStatus;
  customer_reference: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  "id, merchant_id, amount, currency, status, customer_reference, created_at, updated_at";

export const paymentIntentRepository = {
  async insert(
    merchantId: string,
    amount: number,
    currency: string,
    customerReference: string | undefined,
  ): Promise<PaymentIntentRow> {
    const result = await query(
      `INSERT INTO payment_intents (merchant_id, amount, currency, customer_reference)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [merchantId, amount, currency, customerReference ?? null],
    );
    return result.rows[0];
  },

  /** Read one intent (scoped to the merchant so they can't see others'). */
  async findById(
    merchantId: string,
    id: string,
    exec: Executor = pool,
  ): Promise<PaymentIntentRow | null> {
    const result = await exec.query(
      `SELECT ${COLUMNS} FROM payment_intents WHERE id = $1 AND merchant_id = $2`,
      [id, merchantId],
    );
    return result.rows[0] ?? null;
  },

  /**
   * Read AND LOCK an intent for a transition (confirm/cancel). The lock stops
   * two concurrent confirms from both passing the state check and double-
   * charging — same pessimistic-locking idea as transfers.
   */
  async findByIdForUpdate(
    merchantId: string,
    id: string,
    exec: Executor,
  ): Promise<PaymentIntentRow | null> {
    const result = await exec.query(
      `SELECT ${COLUMNS} FROM payment_intents
       WHERE id = $1 AND merchant_id = $2
       FOR UPDATE`,
      [id, merchantId],
    );
    return result.rows[0] ?? null;
  },

  async updateStatus(
    exec: Executor,
    id: string,
    status: PaymentIntentStatus,
  ): Promise<void> {
    await exec.query(
      `UPDATE payment_intents SET status = $1, updated_at = now() WHERE id = $2`,
      [status, id],
    );
  },

  async listByMerchant(merchantId: string): Promise<PaymentIntentRow[]> {
    const result = await query(
      `SELECT ${COLUMNS} FROM payment_intents
       WHERE merchant_id = $1
       ORDER BY created_at DESC`,
      [merchantId],
    );
    return result.rows;
  },
};
