-- =========================================================================
-- Phase 5 — Web Push subscriptions
-- Written by the swing edge function (service role); readable by the owner.
-- VAPID keys live in server_secrets under key 'vapid' (inserted at deploy
-- time; never committed).
-- =========================================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
drop policy if exists "own rows all" on public.push_subscriptions;
create policy "own rows all" on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;
