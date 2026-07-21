import { query } from "../db.js";
import { EmailAlreadyExistsError } from "../errors.js";

export interface MerchantRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

export const merchantRepository = {
  async insert(email: string, passwordHash: string): Promise<MerchantRow> {
    try {
      const result = await query(
        `INSERT INTO merchants (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email, password_hash, created_at, updated_at`,
        [email, passwordHash],
      );
      return result.rows[0];
    } catch (err: any) {
      if (err?.code === "23505") {
        throw new EmailAlreadyExistsError();
      }
      throw err; // anything else bubbles up untouched
    }
  },

  /**
   * Find a merchant by email, or null if none. We'll use this for login.
   */
  async findByEmail(email: string): Promise<MerchantRow | null> {
    const result = await query(
      `SELECT id, email, password_hash, created_at, updated_at
       FROM merchants
       WHERE email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  },

  async findById(id: string): Promise<MerchantRow | null> {
    const result = await query(
      `SELECT id, email, password_hash, created_at, updated_at
       FROM merchants
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },
};
