-- =========================================================================
-- Task 0b (part 2) — backfill user_id, enforce it, enable RLS everywhere.
--
-- ⚠ RUN ONLY AFTER the owner's account exists in auth.users (dashboard →
-- Authentication → Add user). Running earlier locks the app out of its own
-- data. The "own rows" auth.uid() policies from Phase 1 already exist on
-- every table; this turns them on.
-- =========================================================================

do $$
declare
  owner uuid;
  t text;
begin
  select id into owner from auth.users order by created_at limit 1;
  if owner is null then
    raise exception 'No account in auth.users yet — create the owner login first.';
  end if;

  for t in select unnest(array[
    'stocks','candles','levels','watch_plans','positions','discipline_events',
    'screener_runs','alerts','alert_rules','journal','settings'
  ]) loop
    execute format('update public.%I set user_id = $1 where user_id is null', t) using owner;
    execute format('alter table public.%I alter column user_id set default auth.uid()', t);
    execute format('alter table public.%I alter column user_id set not null', t);
    execute format('alter table public.%I enable row level security', t);
    -- Belt and braces: the publishable key maps to anon before sign-in, and
    -- anon has no policies — but revoke its table grants entirely anyway.
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- instruments is shared reference data (NSE symbol map, no user_id):
-- readable by the signed-in user, writable only by the service role.
alter table public.instruments enable row level security;
drop policy if exists "read for authenticated" on public.instruments;
create policy "read for authenticated" on public.instruments
  for select to authenticated using (true);
revoke all on public.instruments from anon;

-- Verification (Task 0c) — run and eyeball:
--   select tablename, rowsecurity from pg_tables where schemaname='public';
--   select tablename, policyname, cmd, qual from pg_policies where schemaname='public';
-- Then, logged out, query the REST API with the publishable key: it must
-- return zero rows / permission errors on every table.
