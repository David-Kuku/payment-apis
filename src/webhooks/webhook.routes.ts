import { Router } from "express";
import { webhookController } from "./webhook.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { registerEndpointSchema } from "./webhook.dto.js";

export const webhookRouter = Router();

webhookRouter.post(
  "/endpoints",
  authenticate,
  validateBody(registerEndpointSchema),
  asyncHandler(webhookController.registerEndpoint),
);

webhookRouter.get(
  "/endpoints",
  authenticate,
  asyncHandler(webhookController.listEndpoints),
);
