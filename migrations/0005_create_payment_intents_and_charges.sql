-- Migration 0005: payment intents (a state machine) + charges.
--
-- A payment_intent tracks ONE payment through its lifecycle:
--   requires_confirmation --confirm--> succeeded
--   requires_confirmation --cancel --> canceled
-- succeeded and canceled are terminal. Any other transition is illegal and the
-- app rejects it.
--
-- When an intent succeeds, we create a `charge` and credit the merchant's wallet
-- via the ledger (money arriving from OUTSIDE the system, like a card payment).

-- Allow 'charge' as a ledger transaction type (a payment crediting a merchant).
ALTER TABLE transactions
    DROP CONSTRAINT transactions_type_check,
    ADD CONSTRAINT transactions_type_check
        CHECK (type IN ('deposit', 'transfer', 'withdrawal', 'charge'));

CREATE TABLE payment_intents (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id        UUID        NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,

    amount             BIGINT      NOT NULL CHECK (amount > 0), -- minor units
    currency           TEXT        NOT NULL,

    -- The state-machine state. CHECK restricts it to the valid states; the app
    -- enforces the allowed TRANSITIONS between them.
    status             TEXT        NOT NULL DEFAULT 'requires_confirmation'
                                   CHECK (status IN ('requires_confirmation', 'succeeded', 'canceled')),

    -- Who's paying — just a free-text reference for now (no customer table yet).
    customer_reference TEXT,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_intents_merchant_id ON payment_intents(merchant_id);

CREATE TABLE charges (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The intent this charge fulfilled.
    payment_intent_id UUID        NOT NULL REFERENCES payment_intents(id) ON DELETE RESTRICT,
    merchant_id       UUID        NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,

    amount            BIGINT      NOT NULL CHECK (amount > 0),
    currency          TEXT        NOT NULL,

    -- Links to the ledger transaction that actually moved the money.
    transaction_id    UUID        NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_charges_payment_intent_id ON charges(payment_intent_id);
CREATE INDEX idx_charges_merchant_id ON charges(merchant_id);
