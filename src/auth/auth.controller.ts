import type { Request, Response } from "express";
import { authService } from "./auth.service.js";
import type { RegisterDto, LoginDto } from "./auth.dto.js";

/**
 * The auth CONTROLLER.
 *
 * Notice how thin these are now:
 *  - Validation happened in the validateBody middleware (so req.body is a valid
 *    RegisterDto here).
 *  - Errors are just THROWN (by the service) and handled centrally.
 * The controller's only job left: call the service, shape the HTTP response.
 */
export const authController = {
  /** POST /auth/register */
  async register(req: Request, res: Response) {
    const dto = req.body as RegisterDto;
    const merchant = await authService.register(dto);
    res.status(201).json({ merchant });
  },

  /** POST /auth/login */
  async login(req: Request, res: Response) {
    const dto = req.body as LoginDto;
    const result = await authService.login(dto);
    res.status(200).json(result);
  },
};
