// Server-only Kite Connect helpers, shared by the client-invoked server
// functions (kite.functions.ts) and the pg_cron ingest route.

import type { SupabaseClient } from "@supabase/supabase-js";

export type Timeframe = "15m" | "1h" | "1d" | "1wk";

export const KITE_INTERVAL: Record<Timeframe, string> = {
  "15m": "15minute",
  "1h": "60minute",
  "1d": "day",
  "1wk": "week",
};

export interface KiteCreds {
  api_key: string;
  access_token: string;
}

export interface CandleRow {
  symbol: string;
  timeframe: Timeframe;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

// Providers throttle parallel bursts and return empty arrays that look like
// "no data" rather than errors — space calls out instead.
export const PROVIDER_CALL_SPACING_MS = 350;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadKiteCreds(): Promise<KiteCreds> {
  const { serverSupabase } = await import("@/integrations/supabase/server-client");
  const supabase = serverSupabase();
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "kite_credentials")
    .maybeSingle();
  if (error) throw new Error(`Load kite creds failed: ${error.message}`);
  const v = data?.value as KiteCreds | null;
  if (!v?.api_key || !v?.access_token) {
    throw new Error("Kite credentials not set. Save them in Settings first.");
  }
  return v;
}

export function kiteHeaders(c: KiteCreds): Record<string, string> {
  return {
    "X-Kite-Version": "3",
    Authorization: `token ${c.api_key}:${c.access_token}`,
  };
}

export function formatIST(d: Date): string {
  // Kite expects "yyyy-mm-dd HH:MM:SS" in exchange (IST) time.
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().replace("T", " ").slice(0, 19);
}

export async function findInstrumentToken(symbol: string): Promise<number> {
  const { serverSupabase } = await import("@/integrations/supabase/server-client");
  const supabase = serverSupabase();
  const { data, error } = await supabase
    .from("instruments")
    .select("instrument_token")
    .eq("tradingsymbol", symbol)
    .eq("exchange", "NSE")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Instrument lookup failed: ${error.message}`);
  if (!data) {
    throw new Error(`Instrument not found for ${symbol}. Run "Sync instruments" in Settings.`);
  }
  return data.instrument_token as number;
}

export async function fetchKiteCandles(
  symbol: string,
  timeframe: Timeframe,
  days: number,
  creds?: KiteCreds,
): Promise<CandleRow[]> {
  const c = creds ?? (await loadKiteCreds());
  const token = await findInstrumentToken(symbol);
  const interval = KITE_INTERVAL[timeframe];
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400 * 1000);
  const url =
    `https://api.kite.trade/instruments/historical/${token}/${interval}` +
    `?from=${encodeURIComponent(formatIST(from))}&to=${encodeURIComponent(formatIST(to))}`;

  const res = await fetch(url, { headers: kiteHeaders(c) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kite historical fetch failed (${res.status}): ${text.slice(0, 250)}`);
  }
  const json = (await res.json()) as {
    status: string;
    data?: { candles?: Array<[string, number, number, number, number, number]> };
    message?: string;
  };
  if (json.status !== "success" || !json.data?.candles) {
    throw new Error(`Kite response: ${json.message ?? "no candles"}`);
  }
  return json.data.candles.map((row) => ({
    symbol,
    timeframe,
    ts: new Date(row[0]).toISOString(),
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    volume: row[5],
  }));
}

export async function upsertCandles(supabase: SupabaseClient, rows: CandleRow[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase
      .from("candles")
      .upsert(chunk, { onConflict: "user_id,symbol,timeframe,ts" });
    if (error) throw new Error(`Candles upsert failed: ${error.message}`);
    inserted += chunk.length;
  }
  return inserted;
}
