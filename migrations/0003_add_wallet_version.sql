-- Migration 0003: add an optimistic-locking version counter to wallets.
--
-- Optimistic locking works like this: read a row along with its `version`, then
-- when you write, say "UPDATE ... WHERE id = $1 AND version = $oldVersion" and
-- bump the version. If someone else changed the row in between, its version no
-- longer matches, ZERO rows update, and you know a conflict happened — so you
-- retry with fresh data. No locks are held; conflicts are detected, not
-- prevented.

ALTER TABLE wallets
    ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
