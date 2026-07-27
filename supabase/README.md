# Supabase — Swing Trade

Project: `mskymzputorcvqehjugq` ("Swing Trades Stocks", ap-south-1)

## Layout

- `migrations/` — timestamped SQL, the source of truth for schema changes.
- `cron.sql` — the two pg_cron schedules. Reads the ingest secret from Vault,
  so there is nothing to fill in; safe to run as-is and to re-run.
- `functions/swing/` — the `swing` edge function: every Kite call, the
  scheduled pipeline, line-crossed detection, alert rules, and Web Push.
- `../SCHEMA.sql` — the original Phase 1 schema, kept for reference.

## Status

Applied to the live database:

| Migration | State |
| --- | --- |
| `20260726090000_phase3_levels_screener` | ✅ applied |
| `20260726110000_task0_server_secrets` | ✅ applied |
| `20260726130000_phase5_push_subscriptions` | ✅ applied |
| `20260726120000_task0_rls_enable` | ✅ applied |

Also live: `server_secrets` holds the Kite credentials, a 256-bit
`ingest_secret` (also in Vault as `ingest_secret`), and the VAPID keypair.
RLS is enabled on every table, `user_id` is `NOT NULL DEFAULT auth.uid()`,
`anon` has been stripped of all table grants, and a trigger on `auth.users`
rejects any second signup.

### The one remaining step

The edge-function deploy needs credentials that cannot be reached from the
build sandbox (its network policy refuses `api.supabase.com`, `*.supabase.co`
and the database port alike), so it runs from CI. Pick either route:

**A — CI, recommended.** Add two repository secrets under
*Settings → Secrets and variables → Actions*:

| Secret | Where to get it |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens |
| `SUPABASE_DB_URL` | Settings → Database → Connection string → URI |

Then run *Actions → “Deploy Supabase backend” → Run workflow*. It deploys the
function, checks it refuses anonymous calls, schedules both cron jobs, prints
the RLS/grants/row-count report, and smoke-tests Kite. From then on it
re-deploys automatically whenever anything under `supabase/functions/`
changes — no further action, ever.

**B — one local command**, if you'd rather not store secrets in GitHub:

```bash
bash scripts/finish-setup.sh sbp_YOUR_TOKEN
# optionally, to schedule cron in the same run:
DB_URL='postgresql://...' bash scripts/finish-setup.sh sbp_YOUR_TOKEN
```

Until one of those runs:

- ✅ Login, Stocks, Plans, Positions, Scorecard, Journal, Alerts inbox,
  Screener, Charts, CSV import, export and offline all work.
- ⏸️ Live Kite fetches ("Refresh from Kite", "Sync instruments") and the
  scheduled intraday / 15:45 IST jobs wait on the deploy.

Levels, the screener and CSV import deliberately run in the browser against
the owner's own rows, so they never depend on the function being up. The
scheduled job runs the same shared engines server-side.

## Connecting to Kite each morning

Kite access tokens last one trading day, and Zerodha issues **no refresh
token** — the login is interactive by design. What can be automated is the
exchange, and that is now fully server-side:

1. Settings → **Connect Kite** sends you to Zerodha's own login page.
2. You authenticate there (password + 2FA — Zerodha never lets a third party
   do this for you).
3. Kite redirects to `/kite/callback?request_token=…`, and the app exchanges
   that token for the day's `access_token` using
   `checksum = SHA256(api_key + request_token + api_secret)`.
4. The token is written to `server_secrets`. You never see or copy it.

So the daily cost is one tap, not a Python script. If your Zerodha session
cookie is still alive, it is a single tap with no typing at all.

**One Kite-side setting:** on your Kite Connect app
(developers.kite.trade → your app), set the redirect URL to
`https://rdbstocks.lovable.app/kite/callback`. Without it Kite sends the
`request_token` somewhere else — in which case use Settings → Manual options
and paste the address you landed on; the exchange still runs server-side.

**Getting the api_key/api_secret in**, once ever — the secret is deliberately
*not* committed, because this repository is public and a committed brokerage
secret would let anyone mint sessions against the app:

- Settings → Manual options → *API key and secret* → Save, or
- add `KITE_API_KEY` / `KITE_API_SECRET` as repository secrets and let the
  deploy workflow seed them.

## The two scheduled jobs

| Job | Schedule (UTC) | IST | Work |
| --- | --- | --- | --- |
| `swing-refresh-5min` | `*/15 3-10 * * 1-5` | 09:15–15:30 | top up 15m + 1d candles, check invalidation lines, evaluate alert rules |
| `swing-nightly-1545` | `15 10 * * 1-5` | 15:45 | refresh dailies, recompute levels, run + persist the screener, summary alert |

The function itself also refuses the refresh outside NSE hours, so the
slightly-wide cron window is harmless.

**Zero-row safety:** if a refresh returns no rows for *every* symbol, that is
treated as provider failure — it raises a critical alert and leaves existing
data untouched rather than overwriting good data with nothing.

## Security posture (verified live 2026-07-26)

Before: RLS was off on all 11 tables, `anon` held full read/write on every
one of them, and the Kite API key + access token sat in `settings`, which the
publishable key in the client bundle could read. Anyone with the URL had the
whole database and the brokerage token.

Now: auth is required, RLS restricts every row to `user_id = auth.uid()`,
`anon` has no grants, and the Kite credentials live in `server_secrets`,
which is RLS-deny-all and reachable only by the service role inside the edge
function. The browser sends the daily token once and can never read it back —
Settings shows only `••••` plus the token's age.

A login screen alone would not have achieved this: the publishable key is
visible in the page source, so anyone could have queried the database
directly and never seen the login.

To re-verify, run the checks in `migrations/20260726120000_task0_rls_enable.sql`
and confirm a logged-out request with the publishable key returns no rows.
