-- Migration 0001: create the merchants table.
-- A "merchant" is a business account that owns everything (customers, wallets,
-- payments). Every future table will point back to a merchant.

CREATE TABLE merchants (
    -- A UUID primary key instead of an auto-incrementing integer (1, 2, 3...).
    -- Why UUID? (1) IDs don't leak how many merchants you have, (2) they can be
    -- generated anywhere without asking the DB "what's the next number?", which
    -- matters once you scale to many servers. gen_random_uuid() is built into
    -- Postgres 16 — no extension needed.
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The login identity. UNIQUE means the database itself guarantees no two
    -- merchants can share an email — even if two signups race at the same time.
    -- This is a CONSTRAINT: the DB enforces it, not just our app code.
    email         TEXT        NOT NULL UNIQUE,

    -- We store a HASH of the password, never the password itself. More on why
    -- when we build the register endpoint. NOT NULL: a merchant must have one.
    password_hash TEXT        NOT NULL,

    -- timestamptz = timestamp WITH time zone. Always use this, never plain
    -- `timestamp`, so times are unambiguous across servers/regions.
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
