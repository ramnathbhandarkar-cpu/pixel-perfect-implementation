import { createFileRoute } from "@tanstack/react-router";

// Public ingest endpoint for pg_cron (see supabase/cron.sql):
//   POST /api/public/ingest  { "job": "refresh_candles" | "nightly_levels_screener" }
//   header: x-ingest-secret: <INGEST_SECRET>
//
// - refresh_candles: 5-minute candle refresh during market hours
// - nightly_levels_screener: 15:45 IST — refresh daily candles, compute
//   levels, run + persist the screener, raise a summary alert
//
// Guarded by the INGEST_SECRET environment variable (fail-closed: the route
// refuses everything until the secret is configured on the deployment).

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const Route = createFileRoute("/api/public/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.INGEST_SECRET;
        if (!secret) {
          return json({ error: "INGEST_SECRET not configured on the server" }, 503);
        }
        const provided =
          request.headers.get("x-ingest-secret") ?? new URL(request.url).searchParams.get("secret");
        if (provided !== secret) {
          return json({ error: "unauthorized" }, 401);
        }

        let job: string;
        try {
          const body = (await request.json()) as { job?: string };
          job = body.job ?? "";
        } catch {
          return json({ error: "body must be JSON: { job: string }" }, 400);
        }

        const { serverSupabase } = await import("@/integrations/supabase/server-client");
        const {
          loadActiveStocks,
          refreshCandlesFromKite,
          computeAndStoreLevels,
          runAndStoreScreener,
          insertAlert,
          istMarketOpenNow,
        } = await import("@/lib/phase3.server");
        const supabase = serverSupabase();

        try {
          const stocks = await loadActiveStocks(supabase);
          if (stocks.length === 0) {
            return json({ ok: true, skipped: "no active symbols" });
          }

          if (job === "refresh_candles") {
            if (!istMarketOpenNow()) {
              return json({ ok: true, skipped: "outside NSE market hours" });
            }
            const refresh = await refreshCandlesFromKite(supabase, stocks, [
              { timeframe: "15m", days: 3 },
              { timeframe: "1d", days: 6 },
            ]);
            if (refresh.allZero) {
              await insertAlert(supabase, {
                alert_type: "provider_failure",
                severity: "critical",
                title: "Candle refresh returned no data",
                body: `Provider returned zero rows for all ${stocks.length} symbols. Existing data left untouched. Check the Kite access token in Settings.`,
                payload: { errors: refresh.errors.slice(0, 10) },
              });
              return json({ ok: false, error: "provider returned zero rows", refresh }, 502);
            }
            return json({ ok: true, job, refresh });
          }

          if (job === "nightly_levels_screener") {
            const refresh = await refreshCandlesFromKite(supabase, stocks, [
              { timeframe: "1d", days: 10 },
            ]);
            if (refresh.allZero) {
              // Provider failure — log, alert, and do NOT overwrite existing
              // good levels/screener data with results built on nothing.
              await insertAlert(supabase, {
                alert_type: "provider_failure",
                severity: "critical",
                title: "Nightly refresh returned no data",
                body: `Provider returned zero rows for all ${stocks.length} symbols. Levels and screener were NOT recomputed; yesterday's data stands. Check the Kite access token.`,
                payload: { errors: refresh.errors.slice(0, 10) },
              });
              return json({ ok: false, error: "provider returned zero rows", refresh }, 502);
            }
            const levels = await computeAndStoreLevels(supabase, stocks);
            const screener = await runAndStoreScreener(supabase, stocks);
            const q = screener.result.qualifying.length;
            const rej =
              screener.result.rejectedThinSupport +
              screener.result.rejectedGeometry +
              screener.result.rejectedRiskBand;
            await insertAlert(supabase, {
              alert_type: "screener_run",
              severity: "info",
              title:
                q === 0
                  ? "Screener: no qualifying setups today"
                  : `Screener: ${q} qualifying setup${q === 1 ? "" : "s"}`,
              body:
                q === 0
                  ? `Scanned ${screener.result.scanned} symbols, ${rej} rejected. A quiet day is a normal result, not a failure.`
                  : `Scanned ${screener.result.scanned} symbols: ${q} qualified, ${rej} rejected. Review on the Screener screen.`,
              payload: { run_date: screener.runDate },
            });
            return json({
              ok: true,
              job,
              refresh: { totalRows: refresh.totalRows, errors: refresh.errors },
              levels,
              screener: {
                runDate: screener.runDate,
                qualifying: q,
                scanned: screener.result.scanned,
                missingData: screener.missingData,
              },
            });
          }

          return json({ error: `unknown job "${job}"` }, 400);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await insertAlert(supabase, {
            alert_type: "ingest_failure",
            severity: "warning",
            title: `Scheduled job failed: ${job}`,
            body: message,
          });
          return json({ ok: false, error: message }, 500);
        }
      },
      GET: async () => json({ error: "POST only" }, 405),
    },
  },
});
