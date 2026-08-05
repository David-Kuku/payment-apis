import { pool, query, type Executor } from "../db.js";
import { WalletAlreadyExistsError } from "../errors.js";

export interface PayoutAccountRow {
  id: string;
  merchant_id: string;
  currency: string;
  bank_name: string;
  account_number: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  "id, merchant_id, currency, bank_name, account_number, is_active, created_at, updated_at";

export const payoutAccountRepository = {
  /**
   * Register a payout account. The UNIQUE (merchant_id, currency) constraint
   * means a second account for the same currency raises 23505.
   */
  async insert(
    merchantId: string,
    currency: string,
    bankName: string,
    accountNumber: string,
  ): Promise<PayoutAccountRow> {
    try {
      const result = await query(
        `INSERT INTO payout_accounts (merchant_id, currency, bank_name, account_number)
         VALUES ($1, $2, $3, $4)
         RETURNING ${COLUMNS}`,
        [merchantId, currency, bankName, accountNumber],
      );
      return result.rows[0];
    } catch (err: any) {
      if (err?.code === "23505") {
        // Reuse the existing conflict error — one account per currency.
        throw new WalletAlreadyExistsError(currency);
      }
      throw err;
    }
  },

  async listByMerchant(merchantId: string): Promise<PayoutAccountRow[]> {
    const result = await query(
      `SELECT ${COLUMNS} FROM payout_accounts WHERE merchant_id = $1 ORDER BY created_at`,
      [merchantId],
    );
    return result.rows;
  },

  /** The active destination for a merchant+currency, or null. */
  async findActive(
    merchantId: string,
    currency: string,
    exec: Executor = pool,
  ): Promise<PayoutAccountRow | null> {
    const result = await exec.query(
      `SELECT ${COLUMNS} FROM payout_accounts
       WHERE merchant_id = $1 AND currency = $2 AND is_active = true`,
      [merchantId, currency],
    );
    return result.rows[0] ?? null;
  },

  /** Look up a specific account by id (the one a payout was bound to). */
  async findById(id: string): Promise<PayoutAccountRow | null> {
    const result = await query(
      `SELECT ${COLUMNS} FROM payout_accounts WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },
};
