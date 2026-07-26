// Phase 3 server orchestration: nightly level computation, screener runs,
// and scheduled candle refresh. Used by phase3.functions.ts (client-invoked)
// and the /api/public/ingest route (pg_cron-invoked).

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeLevels, type DailyCandle } from "@/lib/levels-engine";
import { runScreener, type ScreenerInput, type ScreenerRunResult } from "@/lib/screener-engine";
import {
  fetchKiteCandles,
  loadKiteCreds,
  sleep,
  upsertCandles,
  PROVIDER_CALL_SPACING_MS,
  type Timeframe,
} from "@/lib/kite-api.server";

export const LEVELS_METHOD = "swing_pivot_1y";

export interface ActiveStock {
  symbol: string;
  sector: string | null;
}

// ── IST helpers ──────────────────────────────────────────────

export function istDateString(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function istMarketOpenNow(d: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  // NSE 09:15–15:30, with a small margin either side.
  return minutes >= 9 * 60 + 5 && minutes <= 15 * 60 + 40;
}

// ── data access ──────────────────────────────────────────────

export async function loadActiveStocks(supabase: SupabaseClient): Promise<ActiveStock[]> {
  const { data, error } = await supabase
    .from("stocks")
    .select("symbol, sector, list_type, is_active")
    .neq("list_type", "archived")
    .eq("is_active", true)
    .order("symbol", { ascending: true });
  if (error) throw new Error(`Load stocks failed: ${error.message}`);
  // A symbol can sit in several lists — dedupe, keeping the first sector seen.
  const bySymbol = new Map<string, ActiveStock>();
  for (const row of data ?? []) {
    const existing = bySymbol.get(row.symbol as string);
    if (!existing) {
      bySymbol.set(row.symbol as string, {
        symbol: row.symbol as string,
        sector: (row.sector as string | null) ?? null,
      });
    } else if (!existing.sector && row.sector) {
      existing.sector = row.sector as string;
    }
  }
  return [...bySymbol.values()];
}

async function loadDailyCandles(supabase: SupabaseClient, symbol: string): Promise<DailyCandle[]> {
  // 1 year of daily candles (~250 trading days); fetch a little wide.
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

export async function insertAlert(
  supabase: SupabaseClient,
  alert: {
    symbol?: string | null;
    alert_type: string;
    severity: "info" | "warning" | "critical";
    title: string;
    body: string;
    payload?: unknown;
  },
): Promise<void> {
  const { error } = await supabase.from("alerts").insert({
    symbol: alert.symbol ?? null,
    alert_type: alert.alert_type,
    severity: alert.severity,
    title: alert.title,
    body: alert.body,
    triggered_at: new Date().toISOString(),
    payload: alert.payload ?? null,
  });
  if (error) console.error(`Alert insert failed: ${error.message}`);
}

// ── nightly level computation ────────────────────────────────

export interface LevelsRunSummary {
  asOf: string;
  computed: string[];
  skippedInsufficientData: string[];
  failed: { symbol: string; error: string }[];
}

const round2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

export async function computeAndStoreLevels(
  supabase: SupabaseClient,
  stocks: ActiveStock[],
): Promise<LevelsRunSummary> {
  const asOf = istDateString();
  const summary: LevelsRunSummary = {
    asOf,
    computed: [],
    skippedInsufficientData: [],
    failed: [],
  };
  for (const stock of stocks) {
    try {
      const candles = await loadDailyCandles(supabase, stock.symbol);
      const lv = computeLevels(candles);
      if (!lv) {
        // Not enough history to say anything — keep whatever good row exists
        // from a previous day rather than writing an empty one.
        summary.skippedInsufficientData.push(stock.symbol);
        continue;
      }
      // Delete-then-insert keyed on (symbol, as_of): one row per symbol per
      // day without depending on the live DB's unique-constraint shape.
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
    } catch (e) {
      summary.failed.push({
        symbol: stock.symbol,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return summary;
}

// ── screener run (uses latest stored levels + closes) ────────

export interface ScreenerRunOutcome {
  runDate: string;
  result: ScreenerRunResult;
  missingData: string[]; // symbols without a level row or a recent close
}

export async function buildScreenerInputs(
  supabase: SupabaseClient,
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

  const latestLevel = new Map<string, (typeof levelsRes.data)[number]>();
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

export async function runAndStoreScreener(
  supabase: SupabaseClient,
  stocks: ActiveStock[],
): Promise<ScreenerRunOutcome> {
  const { inputs, missingData } = await buildScreenerInputs(supabase, stocks);
  const result = runScreener(inputs);
  const runDate = istDateString();

  const qualifyingJson = result.qualifying.map((q) => ({
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

  // One persisted run per day: delete-then-insert on run_date.
  const del = await supabase.from("screener_runs").delete().eq("run_date", runDate);
  if (del.error) throw new Error(`Screener run delete failed: ${del.error.message}`);

  const baseRow = {
    run_date: runDate,
    ran_at: new Date().toISOString(),
    qualifying: qualifyingJson,
    rejected_thin_support: result.rejectedThinSupport,
    rejected_geometry: result.rejectedGeometry,
    scanned: result.scanned,
    failed: missingData.length,
  };
  const ins = await supabase
    .from("screener_runs")
    .insert({ ...baseRow, rejected_risk_band: result.rejectedRiskBand });
  if (ins.error) {
    // Live DB may predate the phase3 migration that adds rejected_risk_band —
    // fold those rejections into geometry rather than losing the run.
    const retry = await supabase.from("screener_runs").insert({
      ...baseRow,
      rejected_geometry: result.rejectedGeometry + result.rejectedRiskBand,
    });
    if (retry.error) {
      throw new Error(`Screener run insert failed: ${retry.error.message}`);
    }
  }
  return { runDate, result, missingData };
}

// ── scheduled candle refresh (rate-limited, zero-row safe) ───

export interface RefreshSummary {
  fetched: Record<string, number>;
  totalRows: number;
  errors: { symbol: string; error: string }[];
  allZero: boolean;
}

export async function refreshCandlesFromKite(
  supabase: SupabaseClient,
  stocks: ActiveStock[],
  jobs: { timeframe: Timeframe; days: number }[],
): Promise<RefreshSummary> {
  const creds = await loadKiteCreds();
  const summary: RefreshSummary = {
    fetched: {},
    totalRows: 0,
    errors: [],
    allZero: false,
  };
  for (const stock of stocks) {
    let rowsForSymbol = 0;
    for (const job of jobs) {
      try {
        const rows = await fetchKiteCandles(stock.symbol, job.timeframe, job.days, creds);
        if (rows.length > 0) {
          await upsertCandles(supabase, rows);
          rowsForSymbol += rows.length;
        }
      } catch (e) {
        summary.errors.push({
          symbol: stock.symbol,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await sleep(PROVIDER_CALL_SPACING_MS);
    }
    summary.fetched[stock.symbol] = rowsForSymbol;
    summary.totalRows += rowsForSymbol;
  }
  // Zero rows for *all* symbols = provider failure, not "no data".
  // (This exact bug once silently wiped a working dataset in the predecessor
  // system.) Callers must log, alert, and leave existing data untouched.
  summary.allZero = stocks.length > 0 && summary.totalRows === 0;
  return summary;
}
