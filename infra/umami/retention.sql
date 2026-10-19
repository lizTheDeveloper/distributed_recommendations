-- Retention for Umami 3.x (Postgres): delete analytics older than :days days.
-- Run hourly by the `retention` service in compose.yaml. Websites, users and
-- settings are kept.
BEGIN;
DELETE FROM event_data   WHERE created_at < now() - make_interval(days => :days);
DELETE FROM session_data WHERE created_at < now() - make_interval(days => :days);
DELETE FROM website_event WHERE created_at < now() - make_interval(days => :days);
DELETE FROM session s
 WHERE s.created_at < now() - make_interval(days => :days)
   AND NOT EXISTS (SELECT 1 FROM website_event e WHERE e.session_id = s.session_id)
   AND NOT EXISTS (SELECT 1 FROM session_data d WHERE d.session_id = s.session_id);
COMMIT;
