import { withTransaction } from "../db.js";
import { walletRepository } from "../wallets/wallet.repository.js";
import { ledgerRepository } from "../ledger/ledger.repository.js";
import {
  WalletNotFoundError,
  ForbiddenError,
  CurrencyMismatchError,
  InsufficientFundsError,
} from "../errors.js";
import type { CreateTransferDto, TransferResult } from "./transfer.dto.js";

export const transferService = {
  /**
   * Concurrency-SAFE transfer.
   *
   * The whole thing runs inside ONE database transaction (withTransaction). We
   * lock both wallet rows with SELECT ... FOR UPDATE before touching balances,
   * so concurrent transfers on the same wallet run one-at-a-time instead of
   * racing. Then we adjust balances ATOMICALLY (balance = balance + delta). If
   * anything throws, the whole transaction rolls back — no partial transfers.
   */
  async transfer(
    callerMerchantId: string,
    dto: CreateTransferDto,
  ): Promise<TransferResult> {
    return withTransaction(async (client) => {
      // DEADLOCK AVOIDANCE: if transfer A→B and B→A run at once and each locks
      // its "from" first, they can deadlock (each waiting on the other's row).
      // We prevent this by always locking rows in a consistent order — sorted by
      // id — so everyone acquires locks in the same sequence.
      const [firstId, secondId] = [dto.fromWalletId, dto.toWalletId].sort();
      const lockedFirst = await walletRepository.findByIdForUpdate(client, firstId);
      const lockedSecond = await walletRepository.findByIdForUpdate(client, secondId);

      // Map the locked rows back to source/destination.
      const from = firstId === dto.fromWalletId ? lockedFirst : lockedSecond;
      const to = firstId === dto.fromWalletId ? lockedSecond : lockedFirst;

      if (!from) throw new WalletNotFoundError("source");
      if (!to) throw new WalletNotFoundError("destination");

      // Authorization: you can only send FROM a wallet you own.
      if (from.merchant_id !== callerMerchantId) {
        throw new ForbiddenError("You do not own the source wallet");
      }

      if (from.currency !== to.currency) {
        throw new CurrencyMismatchError();
      }

      const amount = BigInt(dto.amount);

      // Sufficiency check now runs WHILE HOLDING THE LOCK, on a fresh balance —
      // no other transfer can slip between this check and the update below.
      if (BigInt(from.balance) < amount) {
        throw new InsufficientFundsError();
      }

      // Double-entry ledger, in the same transaction.
      const transactionId = await ledgerRepository.createTransaction(client, "transfer");
      await ledgerRepository.addEntry(
        client,
        transactionId,
        from.id,
        "debit",
        dto.amount.toString(),
        from.currency,
      );
      await ledgerRepository.addEntry(
        client,
        transactionId,
        to.id,
        "credit",
        dto.amount.toString(),
        to.currency,
      );

      // Atomic balance moves. (-amount) out of source, (+amount) into destination.
      await walletRepository.applyDelta(client, from.id, (-amount).toString());
      await walletRepository.applyDelta(client, to.id, amount.toString());

      return {
        transactionId,
        fromWalletId: from.id,
        toWalletId: to.id,
        amount: dto.amount,
        currency: from.currency,
      };
    });
  },
};
