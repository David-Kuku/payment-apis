import { randomBytes } from "node:crypto";
import type { Executor } from "../db.js";
import {
  webhookEndpointRepository,
  type WebhookEndpointRow,
} from "./webhook-endpoint.repository.js";
import { webhookEventRepository } from "./webhook-event.repository.js";
import type {
  PublicWebhookEndpoint,
  RegisteredWebhookEndpoint,
} from "./webhook.dto.js";

function toPublic(row: WebhookEndpointRow): PublicWebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    isActive: row.is_active,
    created_at: row.created_at,
  };
}

export const webhookService = {
  /** Register an endpoint and return the signing secret ONCE. */
  async registerEndpoint(
    merchantId: string,
    url: string,
  ): Promise<RegisteredWebhookEndpoint> {
    const secret = "whsec_" + randomBytes(24).toString("hex");
    const row = await webhookEndpointRepository.insert(merchantId, url, secret);
    return { ...toPublic(row), secret };
  },

  async listEndpoints(merchantId: string): Promise<PublicWebhookEndpoint[]> {
    const rows = await webhookEndpointRepository.listByMerchant(merchantId);
    return rows.map(toPublic);
  },

  /**
   * Emit an event. Fans out to the merchant's active endpoints, inserting one
   * outbox row per endpoint — WITHIN the given transaction (`exec`), so the
   * events commit atomically with whatever state change triggered them. This is
   * the transactional-outbox guarantee: no event without the change, and no
   * change without the event.
   */
  async emit(
    exec: Executor,
    merchantId: string,
    eventType: string,
    data: unknown,
  ): Promise<void> {
    const endpoints = await webhookEndpointRepository.listActiveByMerchant(
      merchantId,
      exec,
    );
    for (const endpoint of endpoints) {
      await webhookEventRepository.enqueue(exec, {
        merchantId,
        endpointId: endpoint.id,
        eventType,
        payload: { type: eventType, data },
      });
    }
  },
};
