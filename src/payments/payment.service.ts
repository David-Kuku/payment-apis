import { withTransaction } from "../db.js";
import {
  paymentIntentRepository,
  type PaymentIntentRow,
} from "./payment-intent.repository.js";
import { chargeRepository, type ChargeRow } from "./charge.repository.js";
import { walletRepository } from "../wallets/wallet.repository.js";
import { ledgerRepository } from "../ledger/ledger.repository.js";
import {
  PaymentIntentNotFoundError,
  InvalidStateTransitionError,
  NoWalletForCurrencyError,
} from "../errors.js";
import type {
  CreatePaymentIntentDto,
  PublicPaymentIntent,
  PublicCharge,
  PaymentIntentStatus,
} from "./payment.dto.js";

/**
 * THE STATE MACHINE, in one place: which statuses can move to which.
 * requires_confirmation can become succeeded or canceled; both of those are
 * terminal (empty arrays = no way out).
 */
const TRANSITIONS: Record<PaymentIntentStatus, PaymentIntentStatus[]> = {
  requires_confirmation: ["succeeded", "canceled"],
  succeeded: [],
  canceled: [],
};

/** Throw unless `from → to` is an allowed transition. */
function assertTransition(
  from: PaymentIntentStatus,
  to: PaymentIntentStatus,
  action: string,
): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new InvalidStateTransitionError(from, action);
  }
}

function toPublicIntent(row: PaymentIntentRow): PublicPaymentIntent {
  return {
    id: row.id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    customerReference: row.customer_reference,
    created_at: row.created_at,
  };
}

function toPublicCharge(row: ChargeRow): PublicCharge {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    amount: row.amount,
    currency: row.currency,
    transactionId: row.transaction_id,
    created_at: row.created_at,
  };
}

export const paymentService = {
  /** Create an intent (starts in requires_confirmation). */
  async create(
    merchantId: string,
    dto: CreatePaymentIntentDto,
  ): Promise<PublicPaymentIntent> {
    // Fail early: a merchant can't accept a currency they have no wallet for.
    const wallet = await walletRepository.findByMerchantAndCurrency(
      merchantId,
      dto.currency,
    );
    if (!wallet) throw new NoWalletForCurrencyError(dto.currency);

    const row = await paymentIntentRepository.insert(
      merchantId,
      dto.amount,
      dto.currency,
      dto.customerReference,
    );
    return toPublicIntent(row);
  },

  async get(merchantId: string, id: string): Promise<PublicPaymentIntent> {
    const row = await paymentIntentRepository.findById(merchantId, id);
    if (!row) throw new PaymentIntentNotFoundError();
    return toPublicIntent(row);
  },

  async list(merchantId: string): Promise<PublicPaymentIntent[]> {
    const rows = await paymentIntentRepository.listByMerchant(merchantId);
    return rows.map(toPublicIntent);
  },

  /**
   * CONFIRM: requires_confirmation → succeeded. Creates a charge and credits the
   * merchant's wallet via the ledger (money from outside). All in one
   * transaction, with the intent row locked so concurrent confirms can't both
   * pass the state check.
   */
  async confirm(
    merchantId: string,
    id: string,
  ): Promise<{ intent: PublicPaymentIntent; charge: PublicCharge }> {
    return withTransaction(async (client) => {
      const intent = await paymentIntentRepository.findByIdForUpdate(
        merchantId,
        id,
        client,
      );
      if (!intent) throw new PaymentIntentNotFoundError();

      // The state-machine guard — rejects confirming a terminal intent.
      assertTransition(intent.status, "succeeded", "confirm");

      const wallet = await walletRepository.findByMerchantAndCurrency(
        merchantId,
        intent.currency,
        client,
      );
      if (!wallet) throw new NoWalletForCurrencyError(intent.currency);

      // Money arrives from outside: a 'charge' transaction with a single credit
      // to the merchant's wallet.
      const transactionId = await ledgerRepository.createTransaction(client, "charge");
      await ledgerRepository.addEntry(
        client,
        transactionId,
        wallet.id,
        "credit",
        intent.amount,
        intent.currency,
      );
      await walletRepository.applyDelta(client, wallet.id, intent.amount);

      // Record the charge and advance the state machine.
      const charge = await chargeRepository.insert(client, {
        paymentIntentId: intent.id,
        merchantId,
        amount: intent.amount,
        currency: intent.currency,
        transactionId,
      });
      await paymentIntentRepository.updateStatus(client, intent.id, "succeeded");

      return {
        intent: toPublicIntent({ ...intent, status: "succeeded" }),
        charge: toPublicCharge(charge),
      };
    });
  },

  /** CANCEL: requires_confirmation → canceled. No money moves. */
  async cancel(merchantId: string, id: string): Promise<PublicPaymentIntent> {
    return withTransaction(async (client) => {
      const intent = await paymentIntentRepository.findByIdForUpdate(
        merchantId,
        id,
        client,
      );
      if (!intent) throw new PaymentIntentNotFoundError();

      assertTransition(intent.status, "canceled", "cancel");
      await paymentIntentRepository.updateStatus(client, intent.id, "canceled");

      return toPublicIntent({ ...intent, status: "canceled" });
    });
  },
};
