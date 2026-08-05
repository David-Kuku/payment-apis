-- Migration 0010: settlement / payouts.
--
-- A payout is the "money leaves the platform" step: we sweep a merchant's wallet
-- balance and send it to their bank. It's the mirror of a charge — a DEBIT to the
-- merchant wallet (via the ledger) plus a payout record tracking the transfer to
-- the bank.
--
-- Lifecycle:  pending --bank ok--> paid
--             pending --bank permanently fails--> failed (wallet CREDITED back:
--                                                 a compensating reversal txn)
-- Because we debit the wallet in the SAME transaction that creates the payout,
-- the wallet balance itself is the guard against double-paying — a second run
-- sees the reduced balance and has nothing to sweep.

-- Allow the two new ledger transaction types: the payout debit and its reversal.
ALTER TABLE transactions
    DROP CONSTRAINT transactions_type_check,
    ADD CONSTRAINT transactions_type_check
        CHECK (type IN ('deposit', 'transfer', 'withdrawal', 'charge',
                        'payout', 'payout_reversal'));

-- ── payout_accounts ───────────────────────────────────────────────────────────
-- Where a merchant's money is sent. One active destination per currency.
-- (A real system tokenizes bank details with a PSP; we store them plainly here
-- for learning — never do this with real account data.)
CREATE TABLE payout_accounts (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id    UUID        NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    currency       TEXT        NOT NULL,
    bank_name      TEXT        NOT NULL,
    account_number TEXT        NOT NULL,
    is_active      BOOLEAN     NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One account per currency per merchant.
    UNIQUE (merchant_id, currency)
);

CREATE INDEX idx_payout_accounts_merchant_id ON payout_accounts(merchant_id);

-- ── payouts ───────────────────────────────────────────────────────────────────
CREATE TABLE payouts (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id             UUID        NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    wallet_id               UUID        NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    -- The bank destination this payout was sent to. RESTRICT so an account with
    -- payout history can't be deleted out from under the audit trail.
    payout_account_id       UUID        NOT NULL REFERENCES payout_accounts(id) ON DELETE RESTRICT,
    currency                TEXT        NOT NULL,
    amount                  BIGINT      NOT NULL CHECK (amount > 0),

    status                  TEXT        NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending', 'paid', 'failed')),

    -- The ledger transaction that DEBITED the wallet when this payout was created.
    transaction_id          UUID        NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    -- The compensating transaction that CREDITED the wallet back, if the payout
    -- ultimately failed. NULL until/unless that happens.
    reversal_transaction_id UUID        REFERENCES transactions(id) ON DELETE RESTRICT,

    attempts                INT         NOT NULL DEFAULT 0,
    -- Retry lease / visibility timeout, exactly like the webhook outbox: a claimed
    -- payout is pushed into the future so a crash lets another run pick it up.
    next_attempt_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    failure_reason          TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payouts_merchant_id ON payouts(merchant_id);
-- Fast lookup of "pending payouts whose time has come" for the worker.
CREATE INDEX idx_payouts_due ON payouts(next_attempt_at) WHERE status = 'pending';
