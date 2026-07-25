import type { Request, Response } from "express";
import { webhookService } from "./webhook.service.js";
import type { RegisterEndpointDto } from "./webhook.dto.js";

export const webhookController = {
  /** POST /webhooks/endpoints — register a URL, returns the secret once. */
  async registerEndpoint(req: Request, res: Response) {
    const dto = req.body as RegisterEndpointDto;
    const endpoint = await webhookService.registerEndpoint(
      req.merchant!.id,
      dto.url,
    );
    res.status(201).json({ endpoint });
  },

  /** GET /webhooks/endpoints — list the merchant's endpoints (no secrets). */
  async listEndpoints(req: Request, res: Response) {
    const endpoints = await webhookService.listEndpoints(req.merchant!.id);
    res.status(200).json({ endpoints });
  },
};
