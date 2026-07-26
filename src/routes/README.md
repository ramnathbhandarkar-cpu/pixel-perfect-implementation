# Routes — Swing Trade

TanStack Start file-based routing.

## Layout

| Path | File | Auth |
| --- | --- | --- |
| `/` | `index.tsx` | redirects → `/today` |
| `/auth` | `auth.tsx` | public sign-in / sign-up |
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
| `/api/public/ingest` | `api/public/ingest.ts` | `x-ingest-secret` header (pg_cron) |

The `_authenticated/route.tsx` pathless layout is `ssr: false` and checks
Supabase session in `beforeLoad`, redirecting to `/auth` when signed out.
It also renders the `<AppShell>` (desktop sidebar + mobile bottom tabs).

`routeTree.gen.ts` is auto-generated — never edit by hand.
