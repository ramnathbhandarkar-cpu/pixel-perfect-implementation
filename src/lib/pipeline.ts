import { supabase } from "@/integrations/supabase/client";
import { computeLevels, type DailyCandle } from "@/lib/levels-engine";
import { runScreener, type ScreenerInput, type ScreenerRunResult } from "@/lib/screener-engine";

// Levels, the screener, and CSV import need no secrets — only data the signed-in
// owner can already read under RLS. Running them in the browser keeps them
// working even when the Kite token is stale or the edge function is down.
// The scheduled server-side job runs the exact same engines.

export const LEVELS_METHOD = "swing_pivot_1y";

export interface ActiveStock {
  symbol: string;
  sector: string | null;
}

export function istDateString(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

const round2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

export async function loadActiveStocks(): Promise<ActiveStock[]> {
  const { data, error } = await supabase
    .from("stocks")
    .select("symbol, sector, list_type, is_active")
    .neq("list_type", "archived")
    .eq("is_active", true)
    .order("symbol", { ascending: true });
  if (error) throw new Error(`Load stocks failed: ${error.message}`);
  const bySymbol = new Map<string, ActiveStock>();
  for (const row of data ?? []) {
    const sym = row.symbol as string;
    const existing = bySymbol.get(sym);
    if (!existing) {
      bySymbol.set(sym, { symbol: sym, sector: (row.sector as string | null) ?? null });
    } else if (!existing.sector && row.sector) {
      existing.sector = row.sector as string;
    }
  }
  return [...bySymbol.values()];
}

export async function loadDailyCandles(symbol: string): Promise<DailyCandle[]> {
  const cutoff = new Date(Date.now() - 380 * 86400 * 1000).toISOString();
  const { data, error } = await supabase
    .from("candles")
    .select("ts, open, high, low, close, volume")
    .eq("symbol", symbol)
    .eq("timeframe", "1d")
    .gte("ts", cutoff)
    .order("ts", { ascending: true })
    .limit(400);
  if (error) throw new Error(`Load candles failed for ${symbol}: ${error.message}`);
  return (data ?? []).map((r) => ({
    time: Math.floor(new Date(r.ts as string).getTime() / 1000),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: r.volume == null ? null : Number(r.volume),
  }));
}

export interface LevelsRunSummary {
  asOf: string;
  computed: string[];
  skippedInsufficientData: string[];
  failed: { symbol: string; error: string }[];
}

export async function computeAndStoreLevels(
  stocks: ActiveStock[],
  onProgress?: (done: number, total: number, symbol: string) => void,
): Promise<LevelsRunSummary> {
  const asOf = istDateString();
  const summary: LevelsRunSummary = {
    asOf,
    computed: [],
    skippedInsufficientData: [],
    failed: [],
  };
  let done = 0;
  for (const stock of stocks) {
    try {
      const candles = await loadDailyCandles(stock.symbol);
      const lv = computeLevels(candles);
      if (!lv) {
        // Too little history to say anything — keep any good row from a
        // previous day rather than writing an empty one.
        summary.skippedInsufficientData.push(stock.symbol);
      } else {
        const del = await supabase
          .from("levels")
          .delete()
          .eq("symbol", stock.symbol)
          .eq("as_of", asOf);
        if (del.error) throw new Error(del.error.message);
        const ins = await supabase.from("levels").insert({
          symbol: stock.symbol,
          as_of: asOf,
          support: round2(lv.support),
          resistance: round2(lv.resistance),
          support_tests: lv.supportTests,
          resistance_tests: lv.resistanceTests,
          trend_context: lv.trendContext,
          is_downtrend: lv.isDowntrend,
          method: LEVELS_METHOD,
        });
        if (ins.error) throw new Error(ins.error.message);
        summary.computed.push(stock.symbol);
      }
    } catch (e) {
      summary.failed.push({
        symbol: stock.symbol,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    onProgress?.(++done, stocks.length, stock.symbol);
  }
  return summary;
}

export async function buildScreenerInputs(
  stocks: ActiveStock[],
): Promise<{ inputs: ScreenerInput[]; missingData: string[] }> {
  const symbols = stocks.map((s) => s.symbol);
  if (symbols.length === 0) return { inputs: [], missingData: [] };

  const [levelsRes, closesRes] = await Promise.all([
    supabase
      .from("levels")
      .select(
        "symbol, as_of, support, resistance, support_tests, resistance_tests, trend_context, is_downtrend",
      )
      .in("symbol", symbols)
      .order("as_of", { ascending: false })
      .limit(2000),
    supabase
      .from("candles")
      .select("symbol, ts, close")
      .eq("timeframe", "1d")
      .in("symbol", symbols)
      .gte("ts", new Date(Date.now() - 21 * 86400 * 1000).toISOString())
      .order("ts", { ascending: false })
      .limit(5000),
  ]);
  if (levelsRes.error) throw new Error(`Load levels failed: ${levelsRes.error.message}`);
  if (closesRes.error) throw new Error(`Load closes failed: ${closesRes.error.message}`);

  const latestLevel = new Map<string, Record<string, unknown>>();
  for (const row of levelsRes.data ?? []) {
    if (!latestLevel.has(row.symbol as string)) latestLevel.set(row.symbol as string, row);
  }
  const latestClose = new Map<string, { close: number; ts: string }>();
  for (const row of closesRes.data ?? []) {
    if (!latestClose.has(row.symbol as string)) {
      latestClose.set(row.symbol as string, {
        close: Number(row.close),
        ts: row.ts as string,
      });
    }
  }

  const inputs: ScreenerInput[] = [];
  const missingData: string[] = [];
  for (const stock of stocks) {
    const level = latestLevel.get(stock.symbol);
    const close = latestClose.get(stock.symbol);
    if (!level || !close) {
      missingData.push(stock.symbol);
      continue;
    }
    inputs.push({
      symbol: stock.symbol,
      sector: stock.sector,
      price: close.close,
      priceAsOf: close.ts,
      support: level.support == null ? null : Number(level.support),
      supportTests: Number(level.support_tests ?? 0),
      resistance: level.resistance == null ? null : Number(level.resistance),
      resistanceTests: Number(level.resistance_tests ?? 0),
      trendContext: (level.trend_context as string | null) ?? null,
      isDowntrend: Boolean(level.is_downtrend),
      levelAsOf: level.as_of as string,
    });
  }
  return { inputs, missingData };
}

export interface ScreenerRunOutcome {
  runDate: string;
  result: ScreenerRunResult;
  missingData: string[];
}

export async function runAndStoreScreener(stocks: ActiveStock[]): Promise<ScreenerRunOutcome> {
  const { inputs, missingData } = await buildScreenerInputs(stocks);
  const result = runScreener(inputs);
  const runDate = istDateString();

  const qualifying = result.qualifying.map((q) => ({
    symbol: q.symbol,
    sector: q.sector,
    price: q.price,
    price_as_of: q.priceAsOf ?? null,
    support: q.support,
    support_tests: q.supportTests,
    resistance: q.resistance,
    resistance_tests: q.resistanceTests,
    risk: round2(q.risk),
    reward: round2(q.reward),
    ratio: q.ratio == null ? null : Math.round(q.ratio * 100) / 100,
    risk_pct: q.riskPct == null ? null : Math.round(q.riskPct * 100) / 100,
    score: q.score == null ? null : Math.round(q.score * 1000) / 1000,
    trend_context: q.trendContext,
    is_downtrend: q.isDowntrend,
  }));

  const del = await supabase.from("screener_runs").delete().eq("run_date", runDate);
  if (del.error) throw new Error(`Screener run delete failed: ${del.error.message}`);
  const ins = await supabase.from("screener_runs").insert({
    run_date: runDate,
    ran_at: new Date().toISOString(),
    qualifying,
    rejected_thin_support: result.rejectedThinSupport,
    rejected_geometry: result.rejectedGeometry,
    rejected_risk_band: result.rejectedRiskBand,
    scanned: result.scanned,
    failed: missingData.length,
  });
  if (ins.error) throw new Error(`Screener run insert failed: ${ins.error.message}`);
  return { runDate, result, missingData };
}

// ── CSV candle import (Manual provider) ─────────────────────

export interface ParsedCsv {
  rows: {
    symbol: string;
    timeframe: string;
    ts: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
  }[];
  skipped: number;
}

export function parseCandleCsv(csv: string, symbol: string, timeframe: string): ParsedCsv {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV has no data rows");
  const header = lines[0].split(",").map((s) => s.trim().toLowerCase());
  const iTs = header.findIndex((h) => /^(ts|time|timestamp|date|datetime)$/.test(h));
  const iO = header.indexOf("open");
  const iH = header.indexOf("high");
  const iL = header.indexOf("low");
  const iC = header.indexOf("close");
  const iV = header.findIndex((h) => /volume|vol/.test(h));
  if (iTs < 0 || iO < 0 || iH < 0 || iL < 0 || iC < 0) {
    throw new Error("CSV must include columns: timestamp,open,high,low,close[,volume]");
  }
  // Number("") is 0, so an empty price field would otherwise import as a
  // zero candle. Blank means missing, not zero.
  const strictNum = (raw: string | undefined): number => {
    const s = (raw ?? "").trim();
    return s === "" ? NaN : Number(s);
  };

  const rows: ParsedCsv["rows"] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const t = new Date((cols[iTs] ?? "").trim());
    const o = strictNum(cols[iO]);
    const h = strictNum(cols[iH]);
    const l = strictNum(cols[iL]);
    const c = strictNum(cols[iC]);
    // A malformed row is dropped and counted, never silently coerced.
    if (Number.isNaN(t.getTime()) || ![o, h, l, c].every((n) => Number.isFinite(n))) {
      skipped += 1;
      continue;
    }
    const v = iV >= 0 ? strictNum(cols[iV]) : NaN;
    rows.push({
      symbol,
      timeframe,
      ts: t.toISOString(),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Number.isFinite(v) ? v : null,
    });
  }
  if (rows.length === 0) throw new Error("No valid rows found in the CSV");
  return { rows, skipped };
}

export async function importCandleCsv(
  csv: string,
  symbol: string,
  timeframe: string,
): Promise<{ inserted: number; skipped: number }> {
  const { rows, skipped } = parseCandleCsv(csv, symbol, timeframe);
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase
      .from("candles")
      .upsert(chunk, { onConflict: "user_id,symbol,timeframe,ts" });
    if (error) throw new Error(`Candles upsert failed: ${error.message}`);
    inserted += chunk.length;
  }
  return { inserted, skipped };
}
