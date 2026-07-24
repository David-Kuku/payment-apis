import { Router } from "express";
import { paymentController } from "./payment.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { createPaymentIntentSchema } from "./payment.dto.js";

export const paymentRouter = Router();

paymentRouter.post(
  "/",
  authenticate,
  validateBody(createPaymentIntentSchema),
  asyncHandler(paymentController.create),
);

paymentRouter.get("/", authenticate, asyncHandler(paymentController.list));
paymentRouter.get("/:id", authenticate, asyncHandler(paymentController.get));

// State transitions.
paymentRouter.post(
  "/:id/confirm",
  authenticate,
  asyncHandler(paymentController.confirm),
);
paymentRouter.post(
  "/:id/cancel",
  authenticate,
  asyncHandler(paymentController.cancel),
);
