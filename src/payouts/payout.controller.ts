import type { Request, Response } from "express";
import { payoutService } from "./payout.service.js";
import type { RegisterPayoutAccountDto } from "./payout.dto.js";

export const payoutController = {
  /** POST /payouts/accounts — register the bank destination for a currency. */
  async registerAccount(req: Request, res: Response) {
    const dto = req.body as RegisterPayoutAccountDto;
    const account = await payoutService.registerAccount(req.merchant!.id, dto);
    res.status(201).json({ account });
  },

  /** GET /payouts/accounts — list the merchant's payout accounts. */
  async listAccounts(req: Request, res: Response) {
    const accounts = await payoutService.listAccounts(req.merchant!.id);
    res.status(200).json({ accounts });
  },

  /** GET /payouts — the merchant's payout history. */
  async list(req: Request, res: Response) {
    const payouts = await payoutService.listPayouts(req.merchant!.id);
    res.status(200).json({ payouts });
  },

  /**
   * POST /payouts/run — manually trigger a settlement for THIS merchant now
   * (sweep + process), instead of waiting for the scheduled worker tick. Handy
   * for testing/demoing.
   */
  async runNow(req: Request, res: Response) {
    const payouts = await payoutService.settleNow(req.merchant!.id);
    res.status(200).json({ payouts });
  },
};
