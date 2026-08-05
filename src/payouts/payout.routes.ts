import { Router } from "express";
import { payoutController } from "./payout.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { registerPayoutAccountSchema } from "./payout.dto.js";

export const payoutRouter = Router();

// Bank destinations.
payoutRouter.post(
  "/accounts",
  authenticate,
  validateBody(registerPayoutAccountSchema),
  asyncHandler(payoutController.registerAccount),
);
payoutRouter.get(
  "/accounts",
  authenticate,
  asyncHandler(payoutController.listAccounts),
);

// Payout history + manual settlement trigger.
payoutRouter.get("/", authenticate, asyncHandler(payoutController.list));
payoutRouter.post("/run", authenticate, asyncHandler(payoutController.runNow));
