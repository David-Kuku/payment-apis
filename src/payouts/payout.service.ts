import { withTransaction } from "../db.js";
import { logger } from "../logger.js";
import { payoutsTotal } from "../metrics.js";
import { walletRepository } from "../wallets/wallet.repository.js";
import { ledgerRepository } from "../ledger/ledger.repository.js";
import { webhookService } from "../webhooks/webhook.service.js";
import {
  payoutAccountRepository,
  type PayoutAccountRow,
} from "./payout-account.repository.js";
import { payoutRepository, type PayoutRow } from "./payout.repository.js";
import type {
  PublicPayout,
  PublicPayoutAccount,
  RegisterPayoutAccountDto,
} from "./payout.dto.js";

// The smallest balance worth settling (minor units). Override with PAYOUT_MIN_AMOUNT.
const MIN_PAYOUT_AMOUNT = BigInt(process.env.PAYOUT_MIN_AMOUNT ?? "100");
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 10s, 20s, 40s… capped — same backoff shape as the webhook worker.
const backoffSeconds = (attempt: number) => Math.min(10 * 2 ** (attempt - 1), 300);

function toPublicAccount(row: PayoutAccountRow): PublicPayoutAccount {
  return {
    id: row.id,
    currency: row.currency,
    bankName: row.bank_name,
    accountLast4: row.account_number.slice(-4),
    isActive: row.is_active,
    created_at: row.created_at,
  };
}

function toPublicPayout(row: PayoutRow): PublicPayout {
  return {
    id: row.id,
    walletId: row.wallet_id,
    payoutAccountId: row.payout_account_id,
    currency: row.currency,
    amount: row.amount,
    status: row.status,
    attempts: row.attempts,
    failureReason: row.failure_reason,
    created_at: row.created_at,
  };
}

/**
 * Pretend to send money to the bank. In real life this is a call to a bank/PSP
 * API. For learning, an account number ending in "0000" is a "bad account" that
 * always fails — so you can watch the retry → reversal path deterministically.
 */
async function simulateBankTransfer(account: PayoutAccountRow): Promise<void> {
  await sleep(50);
  if (account.account_number.endsWith("0000")) {
    throw new Error("bank rejected: invalid account");
  }
}

export const payoutService = {
  // ── Merchant-facing API ────────────────────────────────────────────────────
  async registerAccount(
    merchantId: string,
    dto: RegisterPayoutAccountDto,
  ): Promise<PublicPayoutAccount> {
    const row = await payoutAccountRepository.insert(
      merchantId,
      dto.currency,
      dto.bankName,
      dto.accountNumber,
    );
    return toPublicAccount(row);
  },

  async listAccounts(merchantId: string): Promise<PublicPayoutAccount[]> {
    const rows = await payoutAccountRepository.listByMerchant(merchantId);
    return rows.map(toPublicAccount);
  },

  async listPayouts(merchantId: string): Promise<PublicPayout[]> {
    const rows = await payoutRepository.listByMerchant(merchantId);
    return rows.map(toPublicPayout);
  },

  // ── The settlement engine (used by the worker AND the manual trigger) ───────

  /**
   * SWEEP: find wallets worth settling (with an active account) and, for each,
   * atomically DEBIT the wallet via the ledger and create a 'pending' payout.
   *
   * The debit and the payout row commit together, so the reduced balance is the
   * guard against double-paying: a second sweep sees nothing left to settle. The
   * FOR UPDATE lock serializes concurrent sweeps on the same wallet.
   *
   * Returns how many payouts were created.
   */
  async sweep(merchantId?: string): Promise<number> {
    const settleable = await payoutRepository.listSettleableWallets(
      MIN_PAYOUT_AMOUNT,
      merchantId,
    );
    let created = 0;
    for (const w of settleable) {
      const didCreate = await withTransaction(async (client) => {
        // Lock + re-read: the balance may have changed since we listed it.
        const wallet = await walletRepository.findByIdForUpdate(client, w.wallet_id);
        if (!wallet) return false;
        const balance = BigInt(wallet.balance);
        if (balance < MIN_PAYOUT_AMOUNT) return false;

        const amount = balance; // sweep the whole available balance
        const txnId = await ledgerRepository.createTransaction(client, "payout");
        await ledgerRepository.addEntry(
          client,
          txnId,
          wallet.id,
          "debit",
          amount.toString(),
          wallet.currency,
        );
        await walletRepository.applyDelta(client, wallet.id, (-amount).toString());
        await payoutRepository.createPending(client, {
          merchantId: wallet.merchant_id,
          walletId: wallet.id,
          payoutAccountId: w.account_id, // bind to the destination we resolved
          currency: wallet.currency,
          amount,
          transactionId: txnId,
        });
        return true;
      });
      if (didCreate) {
        created++;
        payoutsTotal.inc({ event: "created" });
      }
    }
    if (created > 0) logger.info({ created }, "settlement sweep created payouts");
    return created;
  },

  /** Claim due 'pending' payouts and try to send each to the bank. */
  async processDuePayouts(limit: number, merchantId?: string): Promise<number> {
    const due = await payoutRepository.claimDue(limit, 60, merchantId);
    for (const payout of due) {
      await processOne(payout);
    }
    return due.length;
  },

  /** Manual trigger for one merchant: sweep + process, then return their payouts. */
  async settleNow(merchantId: string): Promise<PublicPayout[]> {
    await this.sweep(merchantId);
    await this.processDuePayouts(100, merchantId);
    return this.listPayouts(merchantId);
  },
};

/** Process a single claimed payout: send to bank → paid, or retry/reverse. */
async function processOne(payout: PayoutRow): Promise<void> {
  // Send to the SPECIFIC account this payout was bound to at sweep time — not
  // "whatever is active now" — so the money goes where the record says it did.
  const account = await payoutAccountRepository.findById(payout.payout_account_id);

  try {
    if (!account || !account.is_active) {
      throw new Error("payout account unavailable");
    }
    await simulateBankTransfer(account);

    // Success: mark paid AND emit the webhook in one transaction.
    await withTransaction(async (client) => {
      await payoutRepository.markPaid(client, payout.id);
      await webhookService.emit(client, payout.merchant_id, "payout.paid", {
        payoutId: payout.id,
        amount: payout.amount,
        currency: payout.currency,
      });
    });
    payoutsTotal.inc({ event: "paid" });
    logger.info({ payoutId: payout.id }, "payout paid");
  } catch (err) {
    const attempts = payout.attempts + 1;
    const message = String((err as any)?.message ?? "bank transfer failed");

    if (attempts < MAX_ATTEMPTS) {
      await payoutRepository.markRetry(
        payout.id,
        attempts,
        backoffSeconds(attempts),
        message,
      );
      logger.warn({ payoutId: payout.id, attempts, err: message }, "payout failed — will retry");
      return;
    }

    // Retries exhausted → COMPENSATE: credit the wallet back (we debited it at
    // sweep time), mark failed, and emit — all atomically.
    await withTransaction(async (client) => {
      const wallet = await walletRepository.findByIdForUpdate(client, payout.wallet_id);
      if (!wallet) throw new Error("wallet missing for reversal");
      const amount = BigInt(payout.amount);
      const revTxnId = await ledgerRepository.createTransaction(
        client,
        "payout_reversal",
      );
      await ledgerRepository.addEntry(
        client,
        revTxnId,
        wallet.id,
        "credit",
        amount.toString(),
        payout.currency,
      );
      await walletRepository.applyDelta(client, wallet.id, amount.toString());
      await payoutRepository.markFailed(client, payout.id, attempts, message, revTxnId);
      await webhookService.emit(client, payout.merchant_id, "payout.failed", {
        payoutId: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        reason: message,
      });
    });
    payoutsTotal.inc({ event: "failed" });
    logger.warn({ payoutId: payout.id, attempts }, "payout failed permanently — reversed");
  }
}
