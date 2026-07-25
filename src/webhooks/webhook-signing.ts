import { createHmac } from "node:crypto";

/**
 * Sign a webhook payload with the endpoint's secret using HMAC-SHA256.
 * We send this as the X-Webhook-Signature header. The merchant recomputes the
 * same HMAC over the raw body with their copy of the secret; if it matches, the
 * request is authentic and untampered (only someone with the secret could
 * produce it).
 */
export function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}
