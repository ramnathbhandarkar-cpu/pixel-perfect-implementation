import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Manual "compute levels + run screener" from the Screener screen.
// The nightly pg_cron job does the same work via /api/public/ingest.
export const computeLevelsAndScreen = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ recomputeLevels: z.boolean().optional() }).parse(raw ?? {}),
  )
  .handler(async ({ data }) => {
    const { serverSupabase } = await import("@/integrations/supabase/server-client");
    const { loadActiveStocks, computeAndStoreLevels, runAndStoreScreener } =
      await import("@/lib/phase3.server");
    const supabase = serverSupabase();
    const stocks = await loadActiveStocks(supabase);
    if (stocks.length === 0) {
      throw new Error("No active symbols. Add stocks first.");
    }
    const levels =
      data.recomputeLevels === false ? null : await computeAndStoreLevels(supabase, stocks);
    const screener = await runAndStoreScreener(supabase, stocks);
    return {
      levels,
      runDate: screener.runDate,
      qualifying: screener.result.qualifying.length,
      scanned: screener.result.scanned,
      rejectedThinSupport: screener.result.rejectedThinSupport,
      rejectedGeometry: screener.result.rejectedGeometry,
      rejectedRiskBand: screener.result.rejectedRiskBand,
      missingData: screener.missingData,
    };
  });
