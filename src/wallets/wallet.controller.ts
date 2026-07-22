import type { Request, Response } from "express";
import { walletService } from "./wallet.service.js";
import type { CreateWalletDto } from "./wallet.dto.js";

export const walletController = {
  /** POST /wallets — create a wallet for the logged-in merchant. */
  async create(req: Request, res: Response) {
    const dto = req.body as CreateWalletDto;
    // Ownership comes from the verified token, NOT from the request body.
    const wallet = await walletService.create(req.merchant!.id, dto);
    res.status(201).json({ wallet });
  },

  /** GET /wallets — list the logged-in merchant's wallets. */
  async list(req: Request, res: Response) {
    const wallets = await walletService.list(req.merchant!.id);
    res.status(200).json({ wallets });
  },
};
