import { pool, query, type Executor } from "../db.js";

export interface WebhookEndpointRow {
  id: string;
  merchant_id: string;
  url: string;
  secret: string;
  is_active: boolean;
  created_at: Date;
}

export const webhookEndpointRepository = {
  async insert(
    merchantId: string,
    url: string,
    secret: string,
  ): Promise<WebhookEndpointRow> {
    const result = await query(
      `INSERT INTO webhook_endpoints (merchant_id, url, secret)
       VALUES ($1, $2, $3)
       RETURNING id, merchant_id, url, secret, is_active, created_at`,
      [merchantId, url, secret],
    );
    return result.rows[0];
  },

  async findById(id: string): Promise<WebhookEndpointRow | null> {
    const result = await query(
      `SELECT id, merchant_id, url, secret, is_active, created_at
       FROM webhook_endpoints WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async listByMerchant(merchantId: string): Promise<WebhookEndpointRow[]> {
    const result = await query(
      `SELECT id, merchant_id, url, secret, is_active, created_at
       FROM webhook_endpoints
       WHERE merchant_id = $1
       ORDER BY created_at`,
      [merchantId],
    );
    return result.rows;
  },

  /**
   * Active endpoints for a merchant. Takes an executor so the emit step can read
   * this inside the SAME transaction that's committing the payment.
   */
  async listActiveByMerchant(
    merchantId: string,
    exec: Executor = pool,
  ): Promise<WebhookEndpointRow[]> {
    const result = await exec.query(
      `SELECT id, merchant_id, url, secret, is_active, created_at
       FROM webhook_endpoints
       WHERE merchant_id = $1 AND is_active = true`,
      [merchantId],
    );
    return result.rows;
  },
};
