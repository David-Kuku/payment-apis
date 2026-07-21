import { Router } from "express";
import { authController } from "./auth.controller.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { registerSchema, loginSchema } from "./auth.dto.js";

/**
 * The auth ROUTER. Each line reads as a pipeline:
 *   validate the body against the DTO -> run the (async) controller.
 * No logic here — just wiring.
 */
export const authRouter = Router();

authRouter.post(
  "/register",
  validateBody(registerSchema),
  asyncHandler(authController.register)
);

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(authController.login)
);
