import { Router } from "express";
import { transferController } from "./transfer.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { idempotency } from "../middleware/idempotency.js";
import { createTransferSchema } from "./transfer.dto.js";

export const transferRouter = Router();

transferRouter.post(
  "/",
  authenticate,
  validateBody(createTransferSchema),
  asyncHandler(idempotency),
  asyncHandler(transferController.create),
);
