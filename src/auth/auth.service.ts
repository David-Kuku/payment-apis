import {
  merchantRepository,
  type MerchantRow,
} from "../merchants/merchant.repository.js";
import { hashPassword, verifyPassword } from "./password.js";
import { signToken } from "./jwt.js";
import { InvalidCredentialsError, UnauthorizedError } from "../errors.js";
import type {
  RegisterDto,
  LoginDto,
  PublicMerchant,
  AuthResponse,
} from "./auth.dto.js";

/**
 * Map a full DB row down to the public-safe output DTO. This mapping stays in
 * the service (not the DTO file) because it's the service's job to bridge the
 * data layer (MerchantRow) and the API contract (PublicMerchant) — and it keeps
 * auth.dto.ts free of any dependency on the repository.
 */
function toPublicMerchant(row: MerchantRow): PublicMerchant {
  return { id: row.id, email: row.email, created_at: row.created_at };
}

export const authService = {
  async register(dto: RegisterDto): Promise<PublicMerchant> {
    const normalizedEmail = dto.email.toLowerCase();
    const passwordHash = await hashPassword(dto.password);
    const created = await merchantRepository.insert(
      normalizedEmail,
      passwordHash,
    );
    return toPublicMerchant(created);
  },

  async login(dto: LoginDto): Promise<AuthResponse> {
    const normalizedEmail = dto.email.toLowerCase();

    const merchant = await merchantRepository.findByEmail(normalizedEmail);
    if (!merchant) {
      throw new InvalidCredentialsError();
    }

    const passwordOk = await verifyPassword(
      dto.password,
      merchant.password_hash,
    );
    if (!passwordOk) {
      throw new InvalidCredentialsError();
    }
    const token = signToken({ sub: merchant.id, email: merchant.email });

    return { token, merchant: toPublicMerchant(merchant) };
  },

  async getById(id: string): Promise<PublicMerchant> {
    const merchant = await merchantRepository.findById(id);
    if (!merchant) {
      throw new UnauthorizedError("Account no longer exists");
    }
    return toPublicMerchant(merchant);
  },
};
