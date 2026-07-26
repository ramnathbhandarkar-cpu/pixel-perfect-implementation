-- =========================================================================
-- pg_cron schedules for Swing Trade — Phase 3
--
-- ⚠ TEMPLATE — replace the two placeholders before running:
--   {{APP_URL}}       e.g. https://your-app.example.com   (no trailing slash)
--   {{INGEST_SECRET}} the same value set as the INGEST_SECRET environment
--                     variable on the app deployment (any long random string)
--
-- Run in Supabase → SQL Editor. pg_cron runs in UTC:
--   09:15–15:30 IST market hours ≈ 03:45–10:00 UTC
--   15:45 IST = 10:15 UTC
-- The endpoint itself also refuses the refresh job outside NSE hours, so the
-- slightly-wide cron window below is harmless.
-- =========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Job 1 — 5-minute candle refresh during market hours (Mon–Fri)
select cron.schedule(
  'swing-trade-refresh-candles',
  '*/5 3-10 * * 1-5',
  $$
  select net.http_post(
    url     := '{{APP_URL}}/api/public/ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ingest-secret', '{{INGEST_SECRET}}'
    ),
    body    := '{"job":"refresh_candles"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Job 2 — 15:45 IST nightly: refresh daily candles, compute levels,
-- run + persist the screener, raise a summary alert
select cron.schedule(
  'swing-trade-nightly-levels-screener',
  '15 10 * * 1-5',
  $$
  select net.http_post(
    url     := '{{APP_URL}}/api/public/ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ingest-secret', '{{INGEST_SECRET}}'
    ),
    body    := '{"job":"nightly_levels_screener"}'::jsonb,
    timeout_milliseconds := 570000
  );
  $$
);

-- To inspect: select * from cron.job;
-- Recent results: select * from cron.job_run_details order by start_time desc limit 20;
-- To remove:
--   select cron.unschedule('swing-trade-refresh-candles');
--   select cron.unschedule('swing-trade-nightly-levels-screener');
