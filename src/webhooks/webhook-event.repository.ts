import { context, propagation } from "@opentelemetry/api";
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
  // The trace context captured at enqueue time (a W3C traceparent carrier),
  // stored so the worker can continue the original request's trace. jsonb comes
  // back from pg already parsed into an object.
  trace_context: Record<string, string> | null;
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
    // Capture the CURRENT trace context into a plain carrier object. If we're
    // inside a traced request, this yields { traceparent: "00-<traceId>-<spanId>-01" }.
    // We persist it so the worker (a different process, later) can resume the
    // same trace when it publishes/delivers this event.
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);

    await exec.query(
      `INSERT INTO webhook_events (merchant_id, endpoint_id, event_type, payload, trace_context)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.merchantId,
        input.endpointId,
        input.eventType,
        JSON.stringify(input.payload),
        JSON.stringify(carrier),
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

  /**
   * RELAY phase 1 — CLAIM: atomically flip a batch of pending events to
   * 'publishing' and return them. One statement, so it's a short auto-committed
   * transaction — no lock is held afterwards. SKIP LOCKED lets multiple relays
   * claim disjoint batches. The row is now hidden from other relays while we
   * publish it (without holding a DB lock across the network call).
   */
  async claimForPublishing(limit: number): Promise<WebhookEventRow[]> {
    const result = await query(
      `UPDATE webhook_events SET status = 'publishing', updated_at = now()
       WHERE id IN (
         SELECT id FROM webhook_events
         WHERE status = 'pending'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       RETURNING id, merchant_id, endpoint_id, event_type, payload, status,
                 attempts, next_attempt_at, last_error, trace_context,
                 created_at, updated_at`,
      [limit],
    );
    return result.rows;
  },

  /** RELAY phase 3 — mark events as safely handed to the broker (confirmed). */
  async markPublished(ids: string[]): Promise<void> {
    await query(
      `UPDATE webhook_events SET status = 'published', updated_at = now()
       WHERE id = ANY($1)`,
      [ids],
    );
  },

  /** RELAY — put a claimed batch back to pending (broker didn't confirm). */
  async resetToPending(ids: string[]): Promise<void> {
    await query(
      `UPDATE webhook_events SET status = 'pending', updated_at = now()
       WHERE id = ANY($1)`,
      [ids],
    );
  },

  /**
   * RELAY reaper — reset rows stuck in 'publishing' longer than staleSeconds
   * (a relay crashed mid-publish) back to 'pending' so they get retried.
   * Returns how many were reaped.
   */
  async reapStalePublishing(staleSeconds: number): Promise<number> {
    const result = await query(
      `UPDATE webhook_events SET status = 'pending', updated_at = now()
       WHERE status = 'publishing'
         AND updated_at < now() - make_interval(secs => $1)`,
      [staleSeconds],
    );
    return result.rowCount ?? 0;
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
