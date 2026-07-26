-- Migration 0008: add a 'publishing' status to webhook_events.
--
-- The safe relay is three phases:
--   pending    -> claimed: flip to 'publishing' (atomic, SKIP LOCKED)
--   publishing -> publish to the broker OUTSIDE any DB transaction, with
--                 publisher confirms; on confirm, flip to 'published'
--   (a reaper resets rows stuck in 'publishing' — a crashed relay — to pending)
--
-- 'publishing' hides a row from other relays while we're mid-publish, without
-- holding a DB lock across the network call.

ALTER TABLE webhook_events
    DROP CONSTRAINT webhook_events_status_check,
    ADD CONSTRAINT webhook_events_status_check
        CHECK (status IN ('pending', 'publishing', 'published', 'delivered', 'failed'));
