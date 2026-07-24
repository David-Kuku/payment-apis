import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { idempotencyRepository } from "../idempotency/idempotency.repository.js";
import {
  IdempotencyKeyRequiredError,
  IdempotencyKeyReuseError,
  IdempotencyInProgressError,
} from "../errors.js";

/** Fingerprint the request so a key reused with different params is detected. */
function hashRequest(req: Request): string {
  const material = `${req.method} ${req.originalUrl} ${JSON.stringify(req.body)}`;
  return createHash("sha256").update(material).digest("hex");
}

/**
 * Idempotency middleware. Requires an Idempotency-Key header, then:
 *  - first time for this key  → run the handler; save its response.
 *  - key seen, different body → 422 (misuse).
 *  - key still in progress    → 409 (a retry arrived mid-flight).
 *  - key completed            → replay the saved response (no re-execution).
 *
 * Must run AFTER `authenticate` (needs req.merchant) and `validateBody` (needs
 * the parsed req.body). Reusable across any mutating endpoint.
 */
export async function idempotency(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = req.headers["idempotency-key"];
  if (!key || typeof key !== "string") {
    throw new IdempotencyKeyRequiredError();
  }

  const merchantId = req.merchant!.id;
  const requestHash = hashRequest(req);

  const { created, existing } = await idempotencyRepository.claim(
    merchantId,
    key,
    requestHash,
  );

  // ── The key already existed ────────────────────────────────────────────────
  if (!created && existing) {
    if (existing.request_hash !== requestHash) {
      throw new IdempotencyKeyReuseError();
    }
    if (existing.status === "in_progress") {
      throw new IdempotencyInProgressError();
    }
    // Completed → replay the original response verbatim. No handler runs.
    req.log.info({ key }, "idempotency: replaying saved response");
    res.status(existing.response_status ?? 200).json(existing.response_body);
    return;
  }

  // ── First time for this key ────────────────────────────────────────────────
  // Intercept res.json so we can persist whatever response the handler produces,
  // THEN send it (persist-before-send avoids a race with a fast retry).
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    const status = res.statusCode;
    const persist =
      status >= 500
        ? // Don't cache server errors — free the key so the client can retry.
          idempotencyRepository.release(merchantId, key)
        : idempotencyRepository.complete(merchantId, key, status, body);

    persist
      .catch((err) => req.log.error({ err }, "idempotency persist failed"))
      .finally(() => originalJson(body));
    return res;
  }) as Response["json"];

  next();
}
