import { pool, query, type Executor } from "../db.js";
import { WalletAlreadyExistsError } from "../errors.js";

/** A wallet row as it lives in the database. balance is a string (BIGINT). */
export interface WalletRow {
  id: string;
  merchant_id: string;
  currency: string;
  balance: string;
  version: number; // optimistic-locking counter
  created_at: Date;
  updated_at: Date;
}

// Every SELECT returns the same columns — keep them in one place.
const WALLET_COLUMNS =
  "id, merchant_id, currency, balance, version, created_at, updated_at";

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
         RETURNING ${WALLET_COLUMNS}`,
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

  /**
   * Find a single wallet by id, or null — a PLAIN read, no lock. Takes an
   * optional executor: defaults to the pool for standalone use, or pass a
   * transaction client to read inside a transaction (used by optimistic
   * transfers, which read without locking).
   */
  async findById(id: string, exec: Executor = pool): Promise<WalletRow | null> {
    const result = await exec.query(
      `SELECT ${WALLET_COLUMNS} FROM wallets WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  /**
   * Find a wallet by id AND LOCK its row for the current transaction
   * (PESSIMISTIC locking).
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
      `SELECT ${WALLET_COLUMNS} FROM wallets WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  /**
   * ATOMICALLY adjust a balance by a signed delta, computed IN THE DATABASE
   * ("balance = balance + delta"). Used by the PESSIMISTIC transfer, where the
   * row is already locked via findByIdForUpdate.
   */
  async applyDelta(exec: Executor, id: string, delta: string): Promise<void> {
    await exec.query(
      `UPDATE wallets
       SET balance = balance + $1::bigint, updated_at = now()
       WHERE id = $2`,
      [delta, id],
    );
  },

  /**
   * OPTIMISTIC update: adjust the balance ONLY IF the row's version still
   * matches what we read. Also bumps the version. Returns true if it updated
   * (version matched) or false if it didn't (someone changed the row first — a
   * conflict). No locks are held; conflicts are detected via the version, not
   * prevented.
   */
  async applyDeltaIfVersion(
    exec: Executor,
    id: string,
    delta: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const result = await exec.query(
      `UPDATE wallets
       SET balance = balance + $1::bigint,
           version = version + 1,
           updated_at = now()
       WHERE id = $2 AND version = $3`,
      [delta, id, expectedVersion],
    );
    return result.rowCount === 1;
  },

  /** Find a merchant's wallet in a specific currency, or null. */
  async findByMerchantAndCurrency(
    merchantId: string,
    currency: string,
    exec: Executor = pool,
  ): Promise<WalletRow | null> {
    const result = await exec.query(
      `SELECT ${WALLET_COLUMNS} FROM wallets
       WHERE merchant_id = $1 AND currency = $2`,
      [merchantId, currency],
    );
    return result.rows[0] ?? null;
  },

  /** List all wallets owned by a merchant, oldest first. */
  async listByMerchant(merchantId: string): Promise<WalletRow[]> {
    const result = await query(
      `SELECT ${WALLET_COLUMNS} FROM wallets WHERE merchant_id = $1
       ORDER BY created_at`,
      [merchantId],
    );
    return result.rows;
  },
};
