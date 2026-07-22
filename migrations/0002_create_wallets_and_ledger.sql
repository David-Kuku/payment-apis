-- Migration 0002: wallets + double-entry ledger.
--
-- Three tables:
--   wallets         - a balance owned by a merchant, in one currency
--   transactions    - one money "event" (a transfer, a deposit, ...)
--   ledger_entries  - the individual debits/credits that make up a transaction
--
-- Rules baked into the schema itself (defense in depth — the DB enforces these
-- even if our app code has a bug):
--   * money is stored as BIGINT in the smallest currency unit (kobo/cents),
--     never a float
--   * a wallet balance can never go negative       (CHECK balance >= 0)
--   * a ledger entry amount is always positive      (CHECK amount > 0)
--   * direction is only ever 'debit' or 'credit'    (CHECK direction IN ...)

-- ── wallets ──────────────────────────────────────────────────────────────────
CREATE TABLE wallets (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The owner. ON DELETE RESTRICT: you cannot delete a merchant while they
    -- still have wallets — protects us from orphaned money.
    merchant_id UUID        NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,

    currency    TEXT        NOT NULL,

    -- Cached balance in minor units. We keep this in sync with the ledger inside
    -- the same DB transaction, so reads are fast (no summing the ledger).
    balance     BIGINT      NOT NULL DEFAULT 0 CHECK (balance >= 0),

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One wallet per currency per merchant.
    UNIQUE (merchant_id, currency)
);

-- Fast lookup of "all wallets for this merchant".
CREATE INDEX idx_wallets_merchant_id ON wallets(merchant_id);

-- ── transactions ─────────────────────────────────────────────────────────────
CREATE TABLE transactions (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What kind of money movement this is. CHECK restricts it to known types.
    type       TEXT        NOT NULL CHECK (type IN ('deposit', 'transfer', 'withdrawal')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── ledger_entries ───────────────────────────────────────────────────────────
CREATE TABLE ledger_entries (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Groups entries that belong to the same transaction. ON DELETE CASCADE:
    -- deleting a transaction removes its entries (they can't exist alone).
    transaction_id UUID        NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,

    -- Which wallet this entry moves. RESTRICT: can't delete a wallet that has
    -- ledger history.
    wallet_id      UUID        NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,

    -- 'debit' = money OUT of the wallet, 'credit' = money IN. amount is always
    -- positive; direction carries the sign.
    direction      TEXT        NOT NULL CHECK (direction IN ('debit', 'credit')),
    amount         BIGINT      NOT NULL CHECK (amount > 0),
    currency       TEXT        NOT NULL,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- These two indexes make "all entries for a wallet" (statements) and "all
-- entries in a transaction" (the two sides of a transfer) fast.
CREATE INDEX idx_ledger_entries_wallet_id ON ledger_entries(wallet_id);
CREATE INDEX idx_ledger_entries_transaction_id ON ledger_entries(transaction_id);
