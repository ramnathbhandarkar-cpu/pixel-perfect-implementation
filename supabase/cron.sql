-- =========================================================================
-- pg_cron schedules for Swing Trade — Task 1
--
-- Jobs call the `swing` edge function with the x-ingest-secret header. The
-- secret lives in Vault (name: ingest_secret) and in server_secrets — both
-- written at deploy time; the value is never committed to the repo.
--
-- pg_cron runs in UTC:
--   09:15–15:30 IST market hours ≈ 03:45–10:00 UTC
--   15:45 IST = 10:15 UTC
-- The edge function itself also refuses the refresh job outside NSE hours,
-- so the slightly-wide cron window below is harmless.
-- =========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Job 1 — 5-minute candle refresh during market hours (Mon–Fri).
-- Also runs line-crossed detection for open positions (Phase 4.3).
select cron.schedule(
  'swing-refresh-5min',
  '*/5 3-10 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://mskymzputorcvqehjugq.supabase.co/functions/v1/swing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ingest-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret')
    ),
    body    := '{"action":"refresh_candles"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- Job 2 — 15:45 IST nightly: refresh daily candles, compute levels,
-- run + persist the screener, check invalidation lines, summary alert.
select cron.schedule(
  'swing-nightly-1545',
  '15 10 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://mskymzputorcvqehjugq.supabase.co/functions/v1/swing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ingest-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret')
    ),
    body    := '{"action":"nightly"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- Inspect:  select jobid, jobname, schedule, active from cron.job;
-- Results:  select * from cron.job_run_details order by start_time desc limit 20;
-- Remove:   select cron.unschedule('swing-refresh-5min');
--           select cron.unschedule('swing-nightly-1545');
