import { query, type Executor } from "../db.js";
import { WalletAlreadyExistsError } from "../errors.js";

/** A wallet row as it lives in the database. balance is a string (BIGINT). */
export interface WalletRow {
  id: string;
  merchant_id: string;
  currency: string;
  balance: string;
  created_at: Date;
  updated_at: Date;
}

export const walletRepository = {
  /**
   * Create a wallet for a merchant in a given currency. The DB's
   * UNIQUE (merchant_id, currency) constraint means a duplicate raises 23505,
   * which we translate to WalletAlreadyExistsError.
   */
  async create(merchantId: string, currency: string): Promise<WalletRow> {
    try {
      const result = await query(
        `INSERT INTO wallets (merchant_id, currency)
         VALUES ($1, $2)
         RETURNING id, merchant_id, currency, balance, created_at, updated_at`,
        [merchantId, currency],
      );
      return result.rows[0];
    } catch (err: any) {
      if (err?.code === "23505") {
        throw new WalletAlreadyExistsError(currency);
      }
      throw err;
    }
  },

  /** Find a single wallet by id, or null. */
  async findById(id: string): Promise<WalletRow | null> {
    const result = await query(
      `SELECT id, merchant_id, currency, balance, created_at, updated_at
       FROM wallets
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  /**
   * Find a wallet by id AND LOCK its row for the current transaction.
   *
   * `FOR UPDATE` takes a row-level lock: any other transaction that tries to
   * SELECT ... FOR UPDATE (or UPDATE) this same row will BLOCK until our
   * transaction commits or rolls back. That's what serializes concurrent
   * transfers on the same wallet — the second one waits, then reads the balance
   * we already updated. Must be called inside a transaction (pass the client).
   */
  async findByIdForUpdate(
    exec: Executor,
    id: string,
  ): Promise<WalletRow | null> {
    const result = await exec.query(
      `SELECT id, merchant_id, currency, balance, created_at, updated_at
       FROM wallets
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  /**
   * ATOMICALLY adjust a balance by a signed delta, computed IN THE DATABASE
   * ("balance = balance + delta") rather than read-modify-write in JS. Combined
   * with the row lock above, this makes concurrent updates safe. The DB's
   * CHECK (balance >= 0) is the final safety net against overdrawing.
   */
  async applyDelta(exec: Executor, id: string, delta: string): Promise<void> {
    await exec.query(
      `UPDATE wallets
       SET balance = balance + $1::bigint, updated_at = now()
       WHERE id = $2`,
      [delta, id],
    );
  },

  /** List all wallets owned by a merchant, oldest first. */
  async listByMerchant(merchantId: string): Promise<WalletRow[]> {
    const result = await query(
      `SELECT id, merchant_id, currency, balance, created_at, updated_at
       FROM wallets
       WHERE merchant_id = $1
       ORDER BY created_at`,
      [merchantId],
    );
    return result.rows;
  },
};
