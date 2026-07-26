# Supabase — Swing Trade

Project: `mskymzputorcvqehjugq`

## Layout

- `migrations/` — timestamped SQL, the source of truth for schema changes.
  Run each new file in the Supabase **SQL Editor** in filename order. Never
  make ad-hoc dashboard edits, or the repo and the live DB drift apart.
- `cron.sql` — pg_cron schedule **template** (deployment-specific values, so
  it is not a migration). Fill in the placeholders before running.
- `../SCHEMA.sql` — the original Phase 1 schema as designed (with auth +
  RLS). The live DB has drifted from it: auth was removed during the Lovable
  build. See the security note below.

## Phase 3 setup status

1. ✅ `migrations/20260726090000_phase3_levels_screener.sql` — **applied to
   the live DB on 2026-07-26**. Besides the screener column and indexes, it
   fixed two live defects found during verification:
   - `instruments` had RLS enabled with no policies, silently blocking the
     app's instrument sync/lookup → RLS disabled to match the other tables.
   - Every `UNIQUE (user_id, …)` constraint was dead weight: `user_id` is
     always NULL with auth removed, and NULLS-DISTINCT semantics meant
     upserts duplicated rows instead of updating. All five were recreated as
     `UNIQUE NULLS NOT DISTINCT`.
2. ⬜ On the app deployment, set the environment variable `INGEST_SECRET` to
   a long random string (e.g. output of `openssl rand -hex 32`). The
   `/api/public/ingest` route refuses all requests until it is set.
3. ⬜ In `cron.sql`, replace `{{APP_URL}}` with the deployed app URL and
   `{{INGEST_SECRET}}` with the same secret, then run it in the SQL Editor
   (pg_cron 1.6 and pg_net are available on the project, not yet enabled —
   the script enables them).
4. ⬜ Backfill history once per symbol: Charts → pick symbol → timeframe
   `1d` → "Refresh from Kite" (fetches ~1 year). The 5-minute cron job only
   tops up recent candles; it does not backfill.

## ⚠ Security note — auth is currently removed (verified live 2026-07-26)

RLS is **disabled on all 11 app tables**, and `anon` holds full
select/insert/update/delete grants on every one of them. The publishable key
ships in the client bundle, so **anyone who has the deployment URL can read
and write the entire database** — trade history, position sizes, and the
Kite credentials stored in `settings` included. This is tolerable only while
the URL is truly private. The decision on restoring auth (or fronting
Supabase with a secret-holding proxy) belongs to the owner — see Section 3
of the Phase 3 handover. Do not quietly leave this as-is when the app is
shared anywhere.
