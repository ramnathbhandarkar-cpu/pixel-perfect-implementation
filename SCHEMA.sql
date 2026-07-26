-- =========================================================================
-- Swing Trade — Phase 1 schema
-- Project: mskymzputorcvqehjugq
-- Run this in Supabase → SQL Editor as project owner.
-- Every table is user_id-scoped with RLS. Publishable key is safe in the app
-- ONLY because these RLS policies exist.
-- =========================================================================

-- extensions -------------------------------------------------------------
create extension if not exists "pgcrypto";

-- helper: default user_id from auth.uid() (used by column defaults)
-- (auth.uid() already exists in Supabase)

-- =====================
-- Universe: stocks
-- =====================
create table if not exists public.stocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null,
  name text,
  exchange text not null default 'NSE',
  sector text,
  list_type text not null check (list_type in ('core','advisory','nifty50','archived')),
  entry_reference numeric,
  is_active boolean not null default true,
  advisory_quarter text,
  created_at timestamptz not null default now(),
  unique (user_id, symbol, list_type)
);
create index if not exists stocks_user_idx on public.stocks (user_id, list_type, symbol);

-- =====================
-- Market data: candles
-- =====================
create table if not exists public.candles (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null,
  timeframe text not null check (timeframe in ('15m','1h','1d','1wk')),
  ts timestamptz not null,
  open numeric, high numeric, low numeric, close numeric, volume bigint,
  unique (user_id, symbol, timeframe, ts)
);
create index if not exists candles_lookup_idx on public.candles (user_id, symbol, timeframe, ts desc);

-- =====================
-- Levels
-- =====================
create table if not exists public.levels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null,
  as_of date not null,
  support numeric,
  resistance numeric,
  support_tests int default 0,
  resistance_tests int default 0,
  trend_context text,
  is_downtrend boolean not null default false,
  method text not null default 'swing_pivot_60d',
  unique (user_id, symbol, as_of)
);

-- =====================
-- Watch plans (discipline core)
-- =====================
create table if not exists public.watch_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null,
  status text not null default 'active' check (status in ('active','resolved','faded')),
  plan_type text not null check (plan_type in ('entry','held_position','re_entry')),
  context text,
  entry_zone_low numeric,
  entry_zone_high numeric,
  invalidation_line numeric not null,
  target_zone_low numeric,
  target_zone_high numeric,
  bullish_conditions jsonb not null default '[]'::jsonb,
  bearish_conditions jsonb not null default '[]'::jsonb,
  caveat text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  outcome text,
  lessons text
);

-- =====================
-- Positions (plan_id NOT NULL enforces plan-before-entry)
-- =====================
create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null,
  plan_id uuid not null references public.watch_plans(id) on delete restrict,
  side text not null default 'long',
  qty int not null,
  entry_price numeric not null,
  entry_at timestamptz not null,
  exit_price numeric,
  exit_at timestamptz,
  status text not null default 'open' check (status in ('open','closed')),
  invalidation_at_entry numeric not null,
  target_at_entry numeric,
  realised_pnl numeric,
  charges numeric not null default 0,
  entry_reason text,
  exit_reason text
);

-- =====================
-- Discipline events
-- =====================
create table if not exists public.discipline_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  position_id uuid references public.positions(id) on delete cascade,
  event_type text not null check (event_type in
    ('line_crossed','exit_honored','exit_delayed','target_hit','plan_missing')),
  detected_at timestamptz not null,
  acted_at timestamptz,
  price_at_detection numeric,
  price_at_action numeric,
  delay_hours numeric,
  delay_cost numeric,
  note text
);

-- =====================
-- Screener runs
-- =====================
create table if not exists public.screener_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  run_date date not null,
  ran_at timestamptz not null default now(),
  qualifying jsonb not null default '[]'::jsonb,
  rejected_thin_support int not null default 0,
  rejected_geometry int not null default 0,
  scanned int,
  failed int,
  unique (user_id, run_date)
);

-- =====================
-- Alerts + rules
-- =====================
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text,
  alert_type text,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  title text,
  body text,
  triggered_at timestamptz not null default now(),
  read_at timestamptz,
  payload jsonb
);

create table if not exists public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null,
  rule_type text not null check (rule_type in ('volume_hourly','level_cross','price_target')),
  threshold numeric,
  timeframe text,
  is_active boolean not null default true,
  last_fired_candle timestamptz
);

-- =====================
-- Journal
-- =====================
create table if not exists public.journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null,
  title text,
  body text,
  mood text,
  tags text[],
  linked_position_id uuid references public.positions(id) on delete set null
);

-- =====================
-- Settings
-- =====================
create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

-- keep settings.updated_at fresh
create or replace function public.touch_settings_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_touch_settings on public.settings;
create trigger trg_touch_settings before update on public.settings
for each row execute function public.touch_settings_updated_at();

-- =========================================================================
-- Grants — required so PostgREST (Data API) can reach these tables at all
-- =========================================================================
grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.stocks, public.candles, public.levels,
  public.watch_plans, public.positions, public.discipline_events,
  public.screener_runs, public.alerts, public.alert_rules,
  public.journal, public.settings
to authenticated;

grant usage on all sequences in schema public to authenticated;
grant all on
  public.stocks, public.candles, public.levels,
  public.watch_plans, public.positions, public.discipline_events,
  public.screener_runs, public.alerts, public.alert_rules,
  public.journal, public.settings
to service_role;

-- =========================================================================
-- RLS + policies
-- =========================================================================
alter table public.stocks             enable row level security;
alter table public.candles            enable row level security;
alter table public.levels             enable row level security;
alter table public.watch_plans        enable row level security;
alter table public.positions          enable row level security;
alter table public.discipline_events  enable row level security;
alter table public.screener_runs      enable row level security;
alter table public.alerts             enable row level security;
alter table public.alert_rules        enable row level security;
alter table public.journal            enable row level security;
alter table public.settings           enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array[
    'stocks','candles','levels','watch_plans','positions','discipline_events',
    'screener_runs','alerts','alert_rules','journal','settings'
  ]) loop
    execute format('drop policy if exists "own rows select" on public.%I', t);
    execute format('drop policy if exists "own rows insert" on public.%I', t);
    execute format('drop policy if exists "own rows update" on public.%I', t);
    execute format('drop policy if exists "own rows delete" on public.%I', t);
    execute format($f$
      create policy "own rows select" on public.%I
        for select to authenticated using (user_id = auth.uid());
      create policy "own rows insert" on public.%I
        for insert to authenticated with check (user_id = auth.uid());
      create policy "own rows update" on public.%I
        for update to authenticated using (user_id = auth.uid())
        with check (user_id = auth.uid());
      create policy "own rows delete" on public.%I
        for delete to authenticated using (user_id = auth.uid());
    $f$, t, t, t, t);
  end loop;
end$$;
