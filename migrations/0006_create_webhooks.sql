-- Migration 0006: webhook endpoints + the webhook_events outbox.
--
-- webhook_endpoints: a merchant's registered URL(s) + a signing secret.
-- webhook_events: the OUTBOX. When something notable happens (a payment
--   succeeds), we insert a row here IN THE SAME TRANSACTION as the state change,
--   so the event is saved atomically with it — never lost, never false. A
--   background worker (next step) drains this table and delivers the events.

CREATE TABLE webhook_endpoints (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    url         TEXT        NOT NULL,
    -- Secret used to HMAC-sign payloads so the merchant can verify authenticity.
    secret      TEXT        NOT NULL,
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_endpoints_merchant_id ON webhook_endpoints(merchant_id);

CREATE TABLE webhook_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    endpoint_id     UUID        NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,

    event_type      TEXT        NOT NULL, -- e.g. 'payment.succeeded'
    payload         JSONB       NOT NULL, -- the body we'll POST

    -- Delivery state machine: pending -> delivered, or pending -> failed (DLQ).
    status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'delivered', 'failed')),

    -- Retry bookkeeping.
    attempts        INTEGER     NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- when it's eligible to send
    last_error      TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A PARTIAL index: only indexes rows the worker cares about (pending ones),
-- ordered by when they're due. Keeps the worker's "give me the next due events"
-- query fast and the index small.
CREATE INDEX idx_webhook_events_due ON webhook_events(next_attempt_at)
    WHERE status = 'pending';

CREATE INDEX idx_webhook_events_merchant_id ON webhook_events(merchant_id);
