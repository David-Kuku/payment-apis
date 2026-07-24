import { query } from "../db.js";

export interface IdempotencyRow {
  id: string;
  merchant_id: string;
  key: string;
  request_hash: string;
  status: "in_progress" | "completed";
  response_status: number | null;
  response_body: unknown | null;
  created_at: Date;
}

export const idempotencyRepository = {
  /**
   * Try to CLAIM a key by inserting a new in_progress row.
   *  - created: true  → we're the first request for this key; proceed.
   *  - created: false → the key already exists; `existing` is the current row
   *    (could be in_progress or completed). We detect this via the UNIQUE
   *    (merchant_id, key) constraint, so two concurrent requests can't both
   *    claim it — exactly one wins.
   */
  async claim(
    merchantId: string,
    key: string,
    requestHash: string,
  ): Promise<{ created: boolean; existing?: IdempotencyRow }> {
    try {
      await query(
        `INSERT INTO idempotency_keys (merchant_id, key, request_hash)
         VALUES ($1, $2, $3)`,
        [merchantId, key, requestHash],
      );
      return { created: true };
    } catch (err: any) {
      if (err?.code === "23505") {
        const existing = await this.get(merchantId, key);
        return { created: false, existing: existing ?? undefined };
      }
      throw err;
    }
  },

  async get(merchantId: string, key: string): Promise<IdempotencyRow | null> {
    const result = await query(
      `SELECT * FROM idempotency_keys WHERE merchant_id = $1 AND key = $2`,
      [merchantId, key],
    );
    return result.rows[0] ?? null;
  },

  /** Save the final response so future retries can replay it. */
  async complete(
    merchantId: string,
    key: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    await query(
      `UPDATE idempotency_keys
       SET status = 'completed', response_status = $3, response_body = $4
       WHERE merchant_id = $1 AND key = $2`,
      [merchantId, key, responseStatus, JSON.stringify(responseBody)],
    );
  },

  /**
   * Remove a claimed key (used when the request failed with a 5xx). We DON'T
   * cache server errors — releasing the key lets the client genuinely retry.
   */
  async release(merchantId: string, key: string): Promise<void> {
    await query(
      `DELETE FROM idempotency_keys WHERE merchant_id = $1 AND key = $2`,
      [merchantId, key],
    );
  },
};
