/**
 * Domain errors — meaningful failures our code can raise.
 *
 * Each one now carries its OWN http status code. That means the global error
 * handler doesn't need a big if/else mapping — it just reads err.statusCode.
 * The service/repository still throw these without importing anything about
 * Express; they only set "what kind of failure and what status it deserves".
 */

export class AppError extends Error {
  /** Stable machine-readable code, e.g. "email_already_registered". */
  code: string;
  /** The HTTP status this failure maps to. */
  statusCode: number;
  /** Optional extra info (e.g. per-field validation messages). */
  details?: unknown;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    details?: unknown,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = this.constructor.name;
  }
}

/** 409 — email already registered. */
export class EmailAlreadyExistsError extends AppError {
  constructor() {
    super(
      "email_already_registered",
      "A merchant with this email already exists",
      409,
    );
  }
}

/** 400 — the request body failed validation. Carries the field-level errors. */
export class ValidationError extends AppError {
  constructor(details: unknown) {
    super("invalid_request", "The request data is invalid", 400, details);
  }
}

/**
 * 401 — login failed. DELIBERATELY vague: we use the SAME error whether the
 * email doesn't exist OR the password is wrong. If we said "no such email" vs
 * "wrong password", an attacker could probe which emails are registered (user
 * enumeration). One generic message reveals nothing.
 */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super("invalid_credentials", "Invalid email or password", 401);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("unauthorized", message, 401);
  }
}

/** 409 — this merchant already has a wallet in this currency. */
export class WalletAlreadyExistsError extends AppError {
  constructor(currency: string) {
    super(
      "wallet_already_exists",
      `A ${currency} wallet already exists for this merchant`,
      409,
    );
  }
}

/** 404 — a referenced wallet doesn't exist. `which` says source/destination. */
export class WalletNotFoundError extends AppError {
  constructor(which: string) {
    super("wallet_not_found", `The ${which} wallet was not found`, 404);
  }
}

/** 403 — the caller is authenticated but not allowed to do this. */
export class ForbiddenError extends AppError {
  constructor(message = "You are not allowed to perform this action") {
    super("forbidden", message, 403);
  }
}

/** 400 — the two wallets in a transfer are in different currencies. */
export class CurrencyMismatchError extends AppError {
  constructor() {
    super(
      "currency_mismatch",
      "Cannot transfer between wallets of different currencies",
      400,
    );
  }
}

/** 422 — the source wallet doesn't have enough balance for the transfer. */
export class InsufficientFundsError extends AppError {
  constructor() {
    super("insufficient_funds", "The source wallet has insufficient funds", 422);
  }
}

/**
 * 409 — an optimistic-locking version check failed: another transaction changed
 * a wallet between our read and our write. Used to trigger a retry; if retries
 * are exhausted it surfaces to the client as a 409.
 */
export class ConcurrencyConflictError extends AppError {
  constructor() {
    super(
      "concurrency_conflict",
      "The wallet was modified concurrently; please retry",
      409,
    );
  }
}

/** 404 — the payment intent doesn't exist (or isn't this merchant's). */
export class PaymentIntentNotFoundError extends AppError {
  constructor() {
    super("payment_intent_not_found", "Payment intent not found", 404);
  }
}

/**
 * 409 — an illegal state-machine transition was attempted, e.g. confirming an
 * already-succeeded intent, or cancelling one that's terminal.
 */
export class InvalidStateTransitionError extends AppError {
  constructor(from: string, action: string) {
    super(
      "invalid_state_transition",
      `Cannot ${action} a payment intent in status "${from}"`,
      409,
    );
  }
}

/** 422 — the merchant has no wallet in the payment's currency to receive into. */
export class NoWalletForCurrencyError extends AppError {
  constructor(currency: string) {
    super(
      "no_wallet_for_currency",
      `You need a ${currency} wallet to accept payments in ${currency}`,
      422,
    );
  }
}

/** 400 — a required Idempotency-Key header was missing. */
export class IdempotencyKeyRequiredError extends AppError {
  constructor() {
    super("idempotency_key_required", "An Idempotency-Key header is required", 400);
  }
}

/**
 * 422 — the same Idempotency-Key was reused with a DIFFERENT request body.
 * That's a client bug: a key must identify exactly one operation.
 */
export class IdempotencyKeyReuseError extends AppError {
  constructor() {
    super(
      "idempotency_key_reuse",
      "This Idempotency-Key was already used with different parameters",
      422,
    );
  }
}

/**
 * 409 — a request with this Idempotency-Key is still being processed (the first
 * one hasn't finished). The client should retry shortly.
 */
export class IdempotencyInProgressError extends AppError {
  constructor() {
    super(
      "idempotency_in_progress",
      "A request with this Idempotency-Key is already in progress",
      409,
    );
  }
}

export class InvalidTokenError extends AppError {
  constructor() {
    super("invalid_token", "Invalid authentication token", 401);
  }
}

export class ExpiredTokenError extends AppError {
  constructor() {
    super("token_expired", "Authentication token has expired", 401);
  }
}
