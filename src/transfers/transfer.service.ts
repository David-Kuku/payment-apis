import { withTransaction, type Executor } from "../db.js";
import { logger } from "../logger.js";
import {
  walletRepository,
  type WalletRow,
} from "../wallets/wallet.repository.js";
import { ledgerRepository } from "../ledger/ledger.repository.js";
import {
  WalletNotFoundError,
  ForbiddenError,
  CurrencyMismatchError,
  InsufficientFundsError,
  ConcurrencyConflictError,
} from "../errors.js";
import type { CreateTransferDto, TransferResult } from "./transfer.dto.js";

const MAX_RETRIES = 5;

/**
 * Shared validation. Throws the right domain error if the transfer isn't
 * allowed. Returns the amount as a BigInt for convenience.
 */
function validate(
  from: WalletRow | null,
  to: WalletRow | null,
  callerMerchantId: string,
  amountMinor: number,
): { from: WalletRow; to: WalletRow; amount: bigint } {
  if (!from) throw new WalletNotFoundError("source");
  if (!to) throw new WalletNotFoundError("destination");
  if (from.merchant_id !== callerMerchantId) {
    throw new ForbiddenError("You do not own the source wallet");
  }
  if (from.currency !== to.currency) throw new CurrencyMismatchError();

  const amount = BigInt(amountMinor);
  if (BigInt(from.balance) < amount) throw new InsufficientFundsError();

  return { from, to, amount };
}

/** Build the ledger entries + return the transaction id. */
async function recordLedger(
  client: Executor,
  from: WalletRow,
  to: WalletRow,
  amountMinor: number,
): Promise<string> {
  const transactionId = await ledgerRepository.createTransaction(client, "transfer");
  await ledgerRepository.addEntry(
    client,
    transactionId,
    from.id,
    "debit",
    amountMinor.toString(),
    from.currency,
  );
  await ledgerRepository.addEntry(
    client,
    transactionId,
    to.id,
    "credit",
    amountMinor.toString(),
    to.currency,
  );
  return transactionId;
}

export const transferService = {
  /**
   * ACTIVE STRATEGY: OPTIMISTIC locking.
   *
   * Read WITHOUT locking (capturing each wallet's version), then update each
   * wallet only if its version is unchanged. If a version check fails (someone
   * raced us), roll back and RETRY with fresh reads, up to MAX_RETRIES.
   *
   * NOTE: for a hot, high-contention wallet this can cause retry storms — the
   * pessimistic version below (SELECT ... FOR UPDATE) is often the better choice
   * there. Kept commented for reference/comparison.
   */
  async transfer(
    callerMerchantId: string,
    dto: CreateTransferDto,
  ): Promise<TransferResult> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await withTransaction(async (client) => {
          // Plain reads — no lock. We capture each wallet's current version.
          const fromRow = await walletRepository.findById(dto.fromWalletId, client);
          const toRow = await walletRepository.findById(dto.toWalletId, client);

          const { from, to, amount } = validate(
            fromRow,
            toRow,
            callerMerchantId,
            dto.amount,
          );

          const transactionId = await recordLedger(client, from, to, dto.amount);

          // Conditional updates: succeed only if the version still matches.
          const okFrom = await walletRepository.applyDeltaIfVersion(
            client,
            from.id,
            (-amount).toString(),
            from.version,
          );
          const okTo = await walletRepository.applyDeltaIfVersion(
            client,
            to.id,
            amount.toString(),
            to.version,
          );

          // If either version changed, someone raced us — abort & retry.
          if (!okFrom || !okTo) {
            throw new ConcurrencyConflictError();
          }

          return {
            transactionId,
            fromWalletId: from.id,
            toWalletId: to.id,
            amount: dto.amount,
            currency: from.currency,
          };
        });
      } catch (err) {
        if (err instanceof ConcurrencyConflictError && attempt < MAX_RETRIES) {
          logger.warn(
            { attempt, fromWalletId: dto.fromWalletId },
            "optimistic transfer conflict — retrying",
          );
          continue;
        }
        throw err;
      }
    }
    // Exhausted retries — surface the conflict to the caller (409).
    throw new ConcurrencyConflictError();
  },
};

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * REFERENCE: PESSIMISTIC locking implementation (SELECT ... FOR UPDATE).
 *
 * This was our first correct fix. It locks both wallet rows up front, so
 * concurrent transfers on the same wallet serialize instead of racing. No
 * retries, no conflicts — for a HOT payment wallet this is often the BETTER
 * choice than the optimistic version above (which retry-storms under high
 * contention). Kept here for comparison.
 *
 * To use it: paste this method back into transferService (rename/replace as you
 * like) and have the controller call it.
 *
 * async transferPessimistic(
 *   callerMerchantId: string,
 *   dto: CreateTransferDto,
 * ): Promise<TransferResult> {
 *   return withTransaction(async (client) => {
 *     // Consistent lock ORDER (sorted by id) avoids A→B / B→A deadlocks.
 *     const [firstId, secondId] = [dto.fromWalletId, dto.toWalletId].sort();
 *     const lockedFirst = await walletRepository.findByIdForUpdate(client, firstId);
 *     const lockedSecond = await walletRepository.findByIdForUpdate(client, secondId);
 *     const fromRow = firstId === dto.fromWalletId ? lockedFirst : lockedSecond;
 *     const toRow = firstId === dto.fromWalletId ? lockedSecond : lockedFirst;
 *
 *     const { from, to, amount } = validate(fromRow, toRow, callerMerchantId, dto.amount);
 *
 *     const transactionId = await recordLedger(client, from, to, dto.amount);
 *
 *     // Rows are locked, so plain atomic deltas are safe.
 *     await walletRepository.applyDelta(client, from.id, (-amount).toString());
 *     await walletRepository.applyDelta(client, to.id, amount.toString());
 *
 *     return {
 *       transactionId,
 *       fromWalletId: from.id,
 *       toWalletId: to.id,
 *       amount: dto.amount,
 *       currency: from.currency,
 *     };
 *   });
 * },
 * ─────────────────────────────────────────────────────────────────────────────
 */
