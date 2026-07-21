import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "password is required"),
});
export type LoginDto = z.infer<typeof loginSchema>;

export interface PublicMerchant {
  id: string;
  email: string;
  created_at: Date;
}

export interface AuthResponse {
  token: string;
  merchant: PublicMerchant;
}
