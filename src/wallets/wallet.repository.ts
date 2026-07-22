import { query } from "../db.js";
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
