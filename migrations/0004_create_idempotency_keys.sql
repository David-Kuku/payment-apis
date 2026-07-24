-- Migration 0004: idempotency keys.
--
-- Stores, per merchant, each client-supplied Idempotency-Key together with the
-- response we produced. A repeated request with the same key replays the saved
-- response instead of executing again — so a client retry can't double-charge.

CREATE TABLE idempotency_keys (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Scope: keys belong to a merchant, so two merchants using the same key
    -- string never collide.
    merchant_id     UUID        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,

    -- The client-provided key (e.g. a UUID).
    key             TEXT        NOT NULL,

    -- Fingerprint of the request (method + path + body). Lets us detect a key
    -- reused with DIFFERENT parameters, which is a client bug we reject.
    request_hash    TEXT        NOT NULL,

    -- 'in_progress' while the first request runs; 'completed' once we have a
    -- response saved.
    status          TEXT        NOT NULL DEFAULT 'in_progress'
                                CHECK (status IN ('in_progress', 'completed')),

    -- The saved response to replay (null until completed).
    response_status INTEGER,
    response_body   JSONB,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The heart of it: one row per (merchant, key). A second concurrent request
    -- with the same key hits this constraint — that's how we detect duplicates
    -- race-free (same trick as the wallet uniqueness).
    UNIQUE (merchant_id, key)
);
