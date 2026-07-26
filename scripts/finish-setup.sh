#!/usr/bin/env bash
# =====================================================================
# Swing Trade — one-command finish of the server-side setup.
#
#   bash scripts/finish-setup.sh sbp_YOUR_ACCESS_TOKEN
#
# Get the token at https://supabase.com/dashboard/account/tokens
#
# It does two things:
#   1. deploys the `swing` edge function (all Kite calls + scheduled jobs)
#   2. schedules the two pg_cron jobs, if a DB connection string is given
#
# To also schedule cron in the same run, pass the connection string too
# (Dashboard → Settings → Database → Connection string → URI):
#
#   DB_URL='postgresql://...' bash scripts/finish-setup.sh sbp_TOKEN
#
# Without DB_URL the script prints exactly what to paste into the SQL
# editor instead. Nothing here stores or echoes a secret.
# =====================================================================
set -euo pipefail

PROJECT_REF="mskymzputorcvqehjugq"
TOKEN="${1:-${SUPABASE_ACCESS_TOKEN:-}}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$TOKEN" ]]; then
  echo "error: pass your Supabase access token as the first argument." >&2
  echo "       bash scripts/finish-setup.sh sbp_..." >&2
  exit 1
fi

echo "==> Deploying the swing edge function to $PROJECT_REF"
# --no-verify-jwt: the function authenticates callers itself (owner JWT for
# app actions, x-ingest-secret for cron), so the platform gate must be off.
SUPABASE_ACCESS_TOKEN="$TOKEN" npx -y supabase@latest functions deploy swing \
  --project-ref "$PROJECT_REF" \
  --no-verify-jwt \
  --workdir "$ROOT"

echo
echo "==> Verifying the function answers and rejects unauthenticated calls"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "https://${PROJECT_REF}.supabase.co/functions/v1/swing" \
  -H 'Content-Type: application/json' \
  -d '{"action":"nightly"}' || true)"
if [[ "$code" == "401" ]]; then
  echo "    ok — function is live and refused an unauthenticated call (401)."
else
  echo "    note — expected 401, got HTTP $code. The function may still be booting."
fi

echo
if [[ -n "${DB_URL:-}" ]]; then
  echo "==> Scheduling the pg_cron jobs"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/cron.sql"
  echo
  echo "==> Scheduled jobs:"
  psql "$DB_URL" -qtAX -c \
    "select jobname || '  ' || schedule || '  active=' || active from cron.job order by jobname;"
else
  echo "==> Cron not scheduled (no DB_URL given)."
  echo "    Open the Supabase SQL editor and run this file as-is:"
  echo "      $ROOT/supabase/cron.sql"
  echo "    It reads the ingest secret from Vault, so there is nothing to fill in."
fi

echo
echo "Done. In the app: Settings → paste today's Kite access token →"
echo "Charts → Sync instruments (once) → Refresh from Kite."
