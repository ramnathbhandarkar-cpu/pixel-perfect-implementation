-- =========================================================================
-- Task 0a — Kite credentials out of the client-readable database
-- Safe to run any time. Idempotent.
-- =========================================================================

-- Server-only secret store: RLS enabled with NO policies = deny-all for
-- anon/authenticated. Only the service-role key (edge functions) can touch
-- it. The ingest_secret row is inserted at deploy time — its value is never
-- committed to the repo.
create table if not exists public.server_secrets (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.server_secrets enable row level security;
revoke all on public.server_secrets from anon, authenticated;

-- Move the Kite credentials row out of settings (client-readable) into
-- server_secrets, leaving only a masked status row for the UI banner.
insert into public.server_secrets (key, value)
select 'kite_credentials',
       value || jsonb_build_object('updated_at', coalesce(value->>'updated_at', now()::text))
from public.settings
where key = 'kite_credentials'
on conflict (key) do update set value = excluded.value, updated_at = now();

insert into public.settings (key, value)
select 'kite_status',
       jsonb_build_object(
         'api_key_masked',
         case when length(coalesce(value->>'api_key', '')) > 4
              then '••••' || right(value->>'api_key', 4) else null end,
         'token_updated_at', coalesce(value->>'updated_at', now()::text))
from public.settings
where key = 'kite_credentials'
on conflict (user_id, key) do update set value = excluded.value;

delete from public.settings where key = 'kite_credentials';

-- Task 0b (part 1) — single-account lock: the first account (created by the
-- owner in the dashboard) is allowed; every later signup is rejected at the
-- database, so the public signup endpoint is useless to anyone else.
create or replace function public.enforce_single_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from auth.users) >= 1 then
    raise exception 'single-account app: signups are disabled';
  end if;
  return new;
end $$;
drop trigger if exists trg_single_user on auth.users;
create trigger trg_single_user before insert on auth.users
for each row execute function public.enforce_single_user();
