import type { Executor } from "../db.js";

type Direction = "debit" | "credit";
type TransactionType = "deposit" | "transfer" | "withdrawal" | "charge";

/**
 * The ledger repository: SQL for `transactions` and `ledger_entries`.
 *
 * Every method takes an Executor (the pool, or a transaction's client). For a
 * transfer we pass the transaction client so the ledger writes commit together
 * with the balance updates — all or nothing.
 */
export const ledgerRepository = {
  /** Create a transaction (the grouping) and return its id. */
  async createTransaction(
    exec: Executor,
    type: TransactionType,
  ): Promise<string> {
    const result = await exec.query(
      `INSERT INTO transactions (type) VALUES ($1) RETURNING id`,
      [type],
    );
    return result.rows[0].id;
  },

  /** Add a single debit or credit line to a transaction. */
  async addEntry(
    exec: Executor,
    transactionId: string,
    walletId: string,
    direction: Direction,
    amount: string,
    currency: string,
  ): Promise<void> {
    await exec.query(
      `INSERT INTO ledger_entries (transaction_id, wallet_id, direction, amount, currency)
       VALUES ($1, $2, $3, $4, $5)`,
      [transactionId, walletId, direction, amount, currency],
    );
  },
};
