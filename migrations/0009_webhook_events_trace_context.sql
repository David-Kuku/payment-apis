-- Migration 0009: carry distributed-trace context through the outbox.
--
-- The event is written to this table in the API process (inside the HTTP request
-- that triggered it) but published to RabbitMQ LATER, by a separate worker
-- process. That async, cross-process gap means normal trace propagation (HTTP /
-- AMQP headers) can't reach across it.
--
-- So we treat the row itself as a propagation CARRIER: at enqueue time the API
-- injects the current trace context (a W3C `traceparent`, and maybe `tracestate`)
-- into this column; at relay time the worker extracts it and publishes under that
-- context — stitching the worker's spans onto the original request's trace.
ALTER TABLE webhook_events
    ADD COLUMN trace_context jsonb;
