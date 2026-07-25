import { query, type Executor } from "../db.js";

export interface WebhookEventRow {
  id: string;
  merchant_id: string;
  endpoint_id: string;
  event_type: string;
  payload: unknown;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  next_attempt_at: Date;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export const webhookEventRepository = {
  /**
   * Add an event to the outbox. Takes an executor so it can run inside the
   * payment's transaction — the event is committed atomically with the charge.
   */
  async enqueue(
    exec: Executor,
    input: {
      merchantId: string;
      endpointId: string;
      eventType: string;
      payload: unknown;
    },
  ): Promise<void> {
    await exec.query(
      `INSERT INTO webhook_events (merchant_id, endpoint_id, event_type, payload)
       VALUES ($1, $2, $3, $4)`,
      [
        input.merchantId,
        input.endpointId,
        input.eventType,
        JSON.stringify(input.payload),
      ],
    );
  },

  /**
   * Claim up to `limit` due events for delivery — the heart of the queue.
   *
   * The subquery picks pending events whose time has come, locking them with
   * FOR UPDATE SKIP LOCKED so that if several workers run at once, each grabs a
   * DIFFERENT set (locked rows are skipped, not waited on) — that's how the
   * worker scales horizontally.
   *
   * We also push next_attempt_at into the future (a "lease"/visibility timeout):
   * if this worker crashes mid-delivery, the row stays pending and becomes due
   * again after the lease, so another worker retries it. That's at-least-once
   * delivery (why receivers must be idempotent).
   */
  async claimDue(limit: number, leaseSeconds = 60): Promise<WebhookEventRow[]> {
    const result = await query(
      `UPDATE webhook_events
       SET next_attempt_at = now() + make_interval(secs => $2), updated_at = now()
       WHERE id IN (
         SELECT id FROM webhook_events
         WHERE status = 'pending' AND next_attempt_at <= now()
         ORDER BY next_attempt_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       RETURNING id, merchant_id, endpoint_id, event_type, payload, status,
                 attempts, next_attempt_at, last_error, created_at, updated_at`,
      [limit, leaseSeconds],
    );
    return result.rows;
  },

  /** Delivery succeeded → terminal 'delivered'. */
  async markDelivered(id: string): Promise<void> {
    await query(
      `UPDATE webhook_events SET status = 'delivered', updated_at = now() WHERE id = $1`,
      [id],
    );
  },

  /** Delivery failed but retries remain → stay pending, back off. */
  async markRetry(
    id: string,
    attempts: number,
    backoffSeconds: number,
    error: string,
  ): Promise<void> {
    await query(
      `UPDATE webhook_events
       SET attempts = $2,
           next_attempt_at = now() + make_interval(secs => $3),
           last_error = $4,
           updated_at = now()
       WHERE id = $1`,
      [id, attempts, backoffSeconds, error],
    );
  },

  /** Retries exhausted → terminal 'failed' (the dead-letter queue). */
  async markFailed(id: string, attempts: number, error: string): Promise<void> {
    await query(
      `UPDATE webhook_events
       SET status = 'failed', attempts = $2, last_error = $3, updated_at = now()
       WHERE id = $1`,
      [id, attempts, error],
    );
  },
};
