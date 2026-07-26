# Routes — Swing Trade

TanStack Start file-based routing.

## Layout

| Path | File | Auth |
| --- | --- | --- |
| `/` | `index.tsx` | redirects → `/today` |
| `/auth` | `auth.tsx` | public sign-in (single account, no signup) |
| `/today` | `_authenticated/today.tsx` | protected |
| `/charts` | `_authenticated/charts.tsx` | protected |
| `/screener` | `_authenticated/screener.tsx` | protected |
| `/plans` | `_authenticated/plans.tsx` | protected |
| `/positions` | `_authenticated/positions.tsx` | protected |
| `/scorecard` | `_authenticated/scorecard.tsx` | protected |
| `/journal` | `_authenticated/journal.tsx` | protected |
| `/alerts` | `_authenticated/alerts.tsx` | protected |
| `/stocks` | `_authenticated/stocks.tsx` | protected |
| `/settings` | `_authenticated/settings.tsx` | protected |

Server-side work (Kite calls, cron jobs, secrets) lives in the `swing`
Supabase edge function — see `supabase/functions/swing/`. There are no
TanStack server functions or API routes anymore.

The `_authenticated/route.tsx` pathless layout is `ssr: false`, checks the
Supabase session in `beforeLoad` (redirecting to `/auth` when signed out),
and renders the `<AppShell>`. The session gate guards the UI only — the
real protection is RLS.

`routeTree.gen.ts` is auto-generated — never edit by hand.
