-- Audit trail: one row per thing that happened to an order, and who did it.
CREATE TABLE IF NOT EXISTS order_events (
  id bigserial PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL CHECK (actor IN ('agent', 'owner', 'paypal')),
  action text NOT NULL,
  detail jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (order_id, id);
--> statement-breakpoint
-- Carry over history from the earlier "events" table, if this database has one.
-- The old table is left in place; nothing reads it any more.
DO $$
BEGIN
  IF to_regclass('public.events') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM order_events) THEN
    INSERT INTO order_events (order_id, created_at, actor, action, detail)
    SELECT e.order_id,
           e.created_at,
           CASE WHEN e.kind = 'webhook' THEN 'paypal' WHEN e.label LIKE 'Owner%' THEN 'owner' ELSE 'agent' END,
           e.label,
           e.detail
    FROM events e
    JOIN orders o ON o.id = e.order_id
    ORDER BY e.id;
  END IF;
END $$;
