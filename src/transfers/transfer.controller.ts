import type { Request, Response } from "express";
import { transferService } from "./transfer.service.js";
import type { CreateTransferDto } from "./transfer.dto.js";

export const transferController = {
  /** POST /transfers — move money from one of my wallets to another wallet. */
  async create(req: Request, res: Response) {
    const dto = req.body as CreateTransferDto;
    // The caller's identity comes from the token; the service checks they own
    // the source wallet.
    const result = await transferService.transfer(req.merchant!.id, dto);
    res.status(201).json({ transfer: result });
  },
};
