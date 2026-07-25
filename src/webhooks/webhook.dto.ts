import { z } from "zod";

export const registerEndpointSchema = z.object({
  url: z.string().url(),
});
export type RegisterEndpointDto = z.infer<typeof registerEndpointSchema>;

/** Endpoint as normally exposed — NO secret. */
export interface PublicWebhookEndpoint {
  id: string;
  url: string;
  isActive: boolean;
  created_at: Date;
}

/** Returned ONCE at registration — includes the secret (like Stripe). */
export interface RegisteredWebhookEndpoint extends PublicWebhookEndpoint {
  secret: string;
}
