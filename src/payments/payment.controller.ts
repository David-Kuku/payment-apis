import type { Request, Response } from "express";
import { paymentService } from "./payment.service.js";
import type { CreatePaymentIntentDto } from "./payment.dto.js";

export const paymentController = {
  /** POST /payment-intents */
  async create(req: Request, res: Response) {
    const dto = req.body as CreatePaymentIntentDto;
    const paymentIntent = await paymentService.create(req.merchant!.id, dto);
    res.status(201).json({ paymentIntent });
  },

  /** GET /payment-intents */
  async list(req: Request, res: Response) {
    const paymentIntents = await paymentService.list(req.merchant!.id);
    res.status(200).json({ paymentIntents });
  },

  /** GET /payment-intents/:id */
  async get(req: Request, res: Response) {
    const paymentIntent = await paymentService.get(req.merchant!.id, req.params.id);
    res.status(200).json({ paymentIntent });
  },

  /** POST /payment-intents/:id/confirm */
  async confirm(req: Request, res: Response) {
    const result = await paymentService.confirm(req.merchant!.id, req.params.id);
    res.status(200).json(result);
  },

  /** POST /payment-intents/:id/cancel */
  async cancel(req: Request, res: Response) {
    const paymentIntent = await paymentService.cancel(req.merchant!.id, req.params.id);
    res.status(200).json({ paymentIntent });
  },
};
