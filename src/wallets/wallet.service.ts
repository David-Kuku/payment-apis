import { walletRepository, type WalletRow } from "./wallet.repository.js";
import type { CreateWalletDto, PublicWallet } from "./wallet.dto.js";

/** Map a full wallet row to the public-safe shape (drops merchant_id, etc.). */
function toPublicWallet(row: WalletRow): PublicWallet {
  return {
    id: row.id,
    currency: row.currency,
    balance: row.balance,
    created_at: row.created_at,
  };
}

export const walletService = {
  /**
   * Create a wallet for a specific merchant. The merchantId comes from the
   * authenticated token (never the request body), so a merchant can only ever
   * create a wallet for themselves.
   */
  async create(merchantId: string, dto: CreateWalletDto): Promise<PublicWallet> {
    const row = await walletRepository.create(merchantId, dto.currency);
    return toPublicWallet(row);
  },

  /** List the calling merchant's own wallets. */
  async list(merchantId: string): Promise<PublicWallet[]> {
    const rows = await walletRepository.listByMerchant(merchantId);
    return rows.map(toPublicWallet);
  },
};
