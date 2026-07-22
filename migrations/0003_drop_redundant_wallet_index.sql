-- Migration 0003: drop a redundant index.
--
-- wallets already has UNIQUE (merchant_id, currency), which creates a composite
-- B-tree index on (merchant_id, currency). A B-tree can be used by its LEFTMOST
-- prefix, so queries filtering by merchant_id alone already use that index.
-- That makes idx_wallets_merchant_id (from migration 0002) redundant — pure
-- write/storage cost for zero read benefit. Remove it.
--
-- IF EXISTS makes this safe to run even if the index was already gone.

DROP INDEX IF EXISTS idx_wallets_merchant_id;
