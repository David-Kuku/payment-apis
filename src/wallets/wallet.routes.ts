import { Router } from "express";
import { walletController } from "./wallet.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { createWalletSchema } from "./wallet.dto.js";

/**
 * Wallet routes. Every line starts with `authenticate` — these are all
 * protected. The pipeline reads: authenticate -> (validate) -> controller.
 */
export const walletRouter = Router();

walletRouter.post(
  "/",
  authenticate,
  validateBody(createWalletSchema),
  asyncHandler(walletController.create),
);

walletRouter.get("/", authenticate, asyncHandler(walletController.list));
