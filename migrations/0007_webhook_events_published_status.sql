-- Migration 0007: add a 'published' status to webhook_events.
--
-- With RabbitMQ, an event's lifecycle becomes:
--   pending    -> relay hasn't published it to the broker yet
--   published  -> relay handed it to RabbitMQ; delivery is now the broker's job
--   delivered  -> consumer POSTed it successfully
--   failed     -> consumer exhausted retries (dead-lettered)
--
-- The 'published' state stops the relay from publishing the same event twice.

ALTER TABLE webhook_events
    DROP CONSTRAINT webhook_events_status_check,
    ADD CONSTRAINT webhook_events_status_check
        CHECK (status IN ('pending', 'published', 'delivered', 'failed'));
