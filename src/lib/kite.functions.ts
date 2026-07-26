import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Kite fetch/upsert internals live in kite-api.server.ts so the pg_cron
// ingest route can reuse them. These server functions stay the client-facing
// entry points.

// ─────────────────────────────────────────────────────────────
// Sync NSE instruments (symbol → instrument_token)
// ─────────────────────────────────────────────────────────────

export const syncInstruments = createServerFn({ method: "POST" }).handler(async () => {
  const { loadKiteCreds, kiteHeaders } = await import("@/lib/kite-api.server");
  const creds = await loadKiteCreds();
  const res = await fetch("https://api.kite.trade/instruments/NSE", {
    headers: kiteHeaders(creds),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kite instruments fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const csv = await res.text();
  const lines = csv.split("\n").filter(Boolean);
  const header = lines[0].split(",");
  const idx = (name: string) => header.indexOf(name);
  const iToken = idx("instrument_token");
  const iExch = idx("exchange_token");
  const iSym = idx("tradingsymbol");
  const iName = idx("name");
  const iSeg = idx("segment");
  const iType = idx("instrument_type");
  const iLot = idx("lot_size");
  const iTick = idx("tick_size");

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols[iType] !== "EQ") continue;
    rows.push({
      instrument_token: Number(cols[iToken]),
      exchange_token: Number(cols[iExch]),
      tradingsymbol: cols[iSym],
      name: cols[iName],
      exchange: "NSE",
      segment: cols[iSeg],
      instrument_type: cols[iType],
      lot_size: Number(cols[iLot]) || null,
      tick_size: Number(cols[iTick]) || null,
      synced_at: new Date().toISOString(),
    });
  }

  const { serverSupabase } = await import("@/integrations/supabase/server-client");
  const supabase = serverSupabase();
  // Upsert in batches of 500
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase
      .from("instruments")
      .upsert(chunk, { onConflict: "instrument_token" });
    if (error) throw new Error(`Instruments upsert failed: ${error.message}`);
    inserted += chunk.length;
  }
  return { count: inserted };
});

// ─────────────────────────────────────────────────────────────
// Ingest candles from Kite
// ─────────────────────────────────────────────────────────────

export const ingestCandles = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        symbol: z.string().min(1).max(50),
        timeframe: z.enum(["15m", "1h", "1d", "1wk"]),
        days: z.number().int().min(1).max(400).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const { fetchKiteCandles, upsertCandles } = await import("@/lib/kite-api.server");

    // Default lookback: 15m=60d, 1h=100d, 1d=365d, 1wk=365d
    const defaults = { "15m": 60, "1h": 100, "1d": 365, "1wk": 365 } as const;
    const days = data.days ?? defaults[data.timeframe];
    const rows = await fetchKiteCandles(data.symbol, data.timeframe, days);
    if (rows.length === 0) {
      return { symbol: data.symbol, timeframe: data.timeframe, inserted: 0 };
    }

    const { serverSupabase } = await import("@/integrations/supabase/server-client");
    const supabase = serverSupabase();
    const inserted = await upsertCandles(supabase, rows);
    return {
      symbol: data.symbol,
      timeframe: data.timeframe,
      inserted,
      latest_ts: rows[rows.length - 1].ts,
    };
  });

// ─────────────────────────────────────────────────────────────
// Ingest CSV candles (Manual provider)
// ─────────────────────────────────────────────────────────────

export const ingestCsvCandles = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        symbol: z.string().min(1).max(50),
        timeframe: z.enum(["15m", "1h", "1d", "1wk"]),
        csv: z.string().min(1).max(5_000_000),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const lines = data.csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV has no data rows");
    const header = lines[0].split(",").map((s) => s.trim().toLowerCase());
    const iTs = header.findIndex((h) => /^(ts|time|timestamp|date)$/.test(h));
    const iO = header.indexOf("open");
    const iH = header.indexOf("high");
    const iL = header.indexOf("low");
    const iC = header.indexOf("close");
    const iV = header.findIndex((h) => /volume|vol/.test(h));
    if (iTs < 0 || iO < 0 || iH < 0 || iL < 0 || iC < 0) {
      throw new Error("CSV must include columns: timestamp,open,high,low,close[,volume]");
    }
    const rows = lines.slice(1).map((line) => {
      const cols = line.split(",");
      return {
        symbol: data.symbol,
        timeframe: data.timeframe,
        ts: new Date(cols[iTs]).toISOString(),
        open: Number(cols[iO]),
        high: Number(cols[iH]),
        low: Number(cols[iL]),
        close: Number(cols[iC]),
        volume: iV >= 0 ? Number(cols[iV]) : null,
      };
    });

    const { serverSupabase } = await import("@/integrations/supabase/server-client");
    const supabase = serverSupabase();
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase
        .from("candles")
        .upsert(chunk, { onConflict: "user_id,symbol,timeframe,ts" });
      if (error) throw new Error(`Candles upsert failed: ${error.message}`);
      inserted += chunk.length;
    }
    return { symbol: data.symbol, timeframe: data.timeframe, inserted };
  });

// ─────────────────────────────────────────────────────────────
// LTP quote (Kite)
// ─────────────────────────────────────────────────────────────

export const getKiteLtp = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ symbols: z.array(z.string().min(1)).min(1).max(200) }).parse(raw),
  )
  .handler(async ({ data }) => {
    const { loadKiteCreds, kiteHeaders } = await import("@/lib/kite-api.server");
    const creds = await loadKiteCreds();
    const params = data.symbols.map((s) => `i=NSE:${encodeURIComponent(s)}`).join("&");
    const res = await fetch(`https://api.kite.trade/quote/ltp?${params}`, {
      headers: kiteHeaders(creds),
    });
    if (!res.ok) {
      throw new Error(`Kite LTP failed (${res.status})`);
    }
    const json = (await res.json()) as {
      status: string;
      data: Record<string, { instrument_token: number; last_price: number }>;
    };
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(json.data ?? {})) {
      const sym = k.split(":")[1] ?? k;
      out[sym] = v.last_price;
    }
    return out;
  });
