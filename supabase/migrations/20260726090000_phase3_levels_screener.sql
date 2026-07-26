-- =========================================================================
-- Phase 3 — Levels + Screener
-- APPLIED to project mskymzputorcvqehjugq on 2026-07-26 (via Supabase MCP,
-- migration name: phase3_levels_screener). Idempotent — safe to re-run.
-- =========================================================================

-- The instruments table already exists on the live DB (created ad-hoc during
-- the Phase 2 build); this definition codifies it for fresh environments and
-- is a no-op on live.
create table if not exists public.instruments (
  instrument_token bigint primary key,
  exchange_token bigint,
  tradingsymbol text not null,
  name text,
  exchange text,
  segment text,
  instrument_type text,
  lot_size integer,
  tick_size numeric,
  synced_at timestamptz default now()
);

-- 1) instruments: RLS was enabled with no policies, which blocked the app's
--    instrument sync/lookup via the publishable key entirely. Match the
--    access model of every other table in this single-user, no-auth
--    deployment (see ../README.md security note — restoring auth is a
--    separate, owner-level decision).
alter table public.instruments disable row level security;

-- 2) screener_runs: third rejection category (stop distance outside the
--    1.5%–8% band). rejected_geometry keeps ratio/no-resistance rejections.
alter table public.screener_runs
  add column if not exists rejected_risk_band int not null default 0;

-- 3) user_id is now always NULL (auth removed) but the UNIQUE constraints
--    include it. Under default NULLS DISTINCT semantics they never conflict,
--    so every upsert silently inserts a duplicate row instead of updating.
--    Recreate them as NULLS NOT DISTINCT so ON CONFLICT works again.
alter table public.candles
  drop constraint if exists candles_user_id_symbol_timeframe_ts_key,
  add constraint candles_user_id_symbol_timeframe_ts_key
    unique nulls not distinct (user_id, symbol, timeframe, ts);
alter table public.levels
  drop constraint if exists levels_user_id_symbol_as_of_key,
  add constraint levels_user_id_symbol_as_of_key
    unique nulls not distinct (user_id, symbol, as_of);
alter table public.screener_runs
  drop constraint if exists screener_runs_user_id_run_date_key,
  add constraint screener_runs_user_id_run_date_key
    unique nulls not distinct (user_id, run_date);
alter table public.settings
  drop constraint if exists settings_user_id_key_key,
  add constraint settings_user_id_key_key
    unique nulls not distinct (user_id, key);
alter table public.stocks
  drop constraint if exists stocks_user_id_symbol_list_type_key,
  add constraint stocks_user_id_symbol_list_type_key
    unique nulls not distinct (user_id, symbol, list_type);

-- 4) lookup indexes for the nightly job and the Screener screen
create index if not exists levels_symbol_asof_idx
  on public.levels (symbol, as_of desc);
create index if not exists candles_symbol_tf_ts_idx
  on public.candles (symbol, timeframe, ts desc);
create index if not exists screener_runs_date_idx
  on public.screener_runs (run_date desc);
