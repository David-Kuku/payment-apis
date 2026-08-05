import { pool, query, type Executor } from "../db.js";

export interface PayoutRow {
  id: string;
  merchant_id: string;
  wallet_id: string;
  payout_account_id: string;
  currency: string;
  amount: string; // BIGINT
  status: "pending" | "paid" | "failed";
  transaction_id: string;
  reversal_transaction_id: string | null;
  attempts: number;
  next_attempt_at: Date;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, merchant_id, wallet_id, payout_account_id, currency, amount,
                 status, transaction_id, reversal_transaction_id, attempts,
                 next_attempt_at, failure_reason, created_at, updated_at`;

/** A wallet that has money to settle AND an active payout account for it. */
export interface SettleableWallet {
  wallet_id: string;
  merchant_id: string;
  currency: string;
  balance: string;
  account_id: string;
}

export const payoutRepository = {
  /**
   * Find wallets whose balance is worth settling and that HAVE an active payout
   * account for that currency (no destination → nothing to do). This is the
   * batch worker's "find work" query.
   */
  async listSettleableWallets(
    minAmount: bigint,
    merchantId?: string,
  ): Promise<SettleableWallet[]> {
    const params: unknown[] = [minAmount.toString()];
    let where = "w.balance >= $1::bigint";
    if (merchantId) {
      params.push(merchantId);
      where += ` AND w.merchant_id = $${params.length}`;
    }
    const result = await query(
      `SELECT w.id AS wallet_id, w.merchant_id, w.currency, w.balance,
              a.id AS account_id
       FROM wallets w
       JOIN payout_accounts a
         ON a.merchant_id = w.merchant_id
        AND a.currency = w.currency
        AND a.is_active = true
       WHERE ${where}`,
      params,
    );
    return result.rows;
  },

  /** Create a payout row in 'pending' — called inside the debit transaction. */
  async createPending(
    exec: Executor,
    input: {
      merchantId: string;
      walletId: string;
      payoutAccountId: string;
      currency: string;
      amount: bigint;
      transactionId: string;
    },
  ): Promise<PayoutRow> {
    const result = await exec.query(
      `INSERT INTO payouts
         (merchant_id, wallet_id, payout_account_id, currency, amount, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [
        input.merchantId,
        input.walletId,
        input.payoutAccountId,
        input.currency,
        input.amount.toString(),
        input.transactionId,
      ],
    );
    return result.rows[0];
  },

  /**
   * Claim due 'pending' payouts for processing — same lease pattern as the
   * webhook outbox: push next_attempt_at into the future under FOR UPDATE SKIP
   * LOCKED, so concurrent workers grab disjoint batches and a crash lets the
   * lease expire and another worker retry.
   */
  async claimDue(
    limit: number,
    leaseSeconds = 60,
    merchantId?: string,
  ): Promise<PayoutRow[]> {
    const params: unknown[] = [limit, leaseSeconds];
    let extra = "";
    if (merchantId) {
      params.push(merchantId);
      extra = ` AND merchant_id = $${params.length}`;
    }
    const result = await query(
      `UPDATE payouts
       SET next_attempt_at = now() + make_interval(secs => $2), updated_at = now()
       WHERE id IN (
         SELECT id FROM payouts
         WHERE status = 'pending' AND next_attempt_at <= now()${extra}
         ORDER BY next_attempt_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       RETURNING ${COLUMNS}`,
      params,
    );
    return result.rows;
  },

  /** Bank confirmed → terminal 'paid'. Runs inside the emit transaction. */
  async markPaid(exec: Executor, id: string): Promise<void> {
    await exec.query(
      `UPDATE payouts SET status = 'paid', updated_at = now() WHERE id = $1`,
      [id],
    );
  },

  /** Bank failed but retries remain → stay pending, back off. */
  async markRetry(
    id: string,
    attempts: number,
    backoffSeconds: number,
    error: string,
  ): Promise<void> {
    await query(
      `UPDATE payouts
       SET attempts = $2,
           next_attempt_at = now() + make_interval(secs => $3),
           failure_reason = $4,
           updated_at = now()
       WHERE id = $1`,
      [id, attempts, backoffSeconds, error],
    );
  },

  /**
   * Retries exhausted → terminal 'failed', recording the reversal transaction
   * that credited the money back. Runs inside the reversal transaction.
   */
  async markFailed(
    exec: Executor,
    id: string,
    attempts: number,
    error: string,
    reversalTransactionId: string,
  ): Promise<void> {
    await exec.query(
      `UPDATE payouts
       SET status = 'failed', attempts = $2, failure_reason = $3,
           reversal_transaction_id = $4, updated_at = now()
       WHERE id = $1`,
      [id, attempts, error, reversalTransactionId],
    );
  },

  async listByMerchant(merchantId: string): Promise<PayoutRow[]> {
    const result = await query(
      `SELECT ${COLUMNS} FROM payouts WHERE merchant_id = $1
       ORDER BY created_at DESC`,
      [merchantId],
    );
    return result.rows;
  },
};
