import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { callSwing, marketDataHint } from "@/lib/swing-api";
import { importCandleCsv } from "@/lib/pipeline";
import { distanceToLinePct } from "@/lib/discipline";
import type { Candle, Overlay } from "@/components/candle-chart";

// Chart uses browser-only lightweight-charts — lazy-load behind a client gate.
const CandleChart = lazy(() =>
  import("@/components/candle-chart").then((m) => ({ default: m.CandleChart })),
);

export const Route = createFileRoute("/_authenticated/charts")({
  head: () => ({
    meta: [
      { title: "Charts · Swing Trade" },
      {
        name: "description",
        content: "Candlestick charts with MA/BB/RSI/MACD/VWAP indicators and level overlays.",
      },
    ],
  }),
  ssr: false,
  component: ChartsScreen,
});

type Timeframe = "15m" | "1h" | "1d" | "1wk";
const TFS: Timeframe[] = ["15m", "1h", "1d", "1wk"];

interface StockRow {
  id: string;
  symbol: string;
  name: string | null;
  list_type: string;
  entry_reference: number | null;
}

interface LevelRow {
  support: number | null;
  resistance: number | null;
  support_tests: number | null;
  resistance_tests: number | null;
  trend_context: string | null;
  as_of: string;
}

interface PlanRow {
  id: string;
  invalidation_line: number;
  target_zone_low: number | null;
  target_zone_high: number | null;
}

const PREFS_KEY = "swing-chart-prefs";

interface Prefs {
  timeframe: Timeframe;
  symbol: string;
  ma20: boolean;
  ma50: boolean;
  ma200: boolean;
  ema9: boolean;
  bb: boolean;
  vwap: boolean;
  rsi: boolean;
  macd: boolean;
}

const DEFAULT_PREFS: Prefs = {
  timeframe: "1d",
  symbol: "",
  ma20: true,
  ma50: true,
  ma200: true,
  ema9: false,
  bb: false,
  vwap: false,
  rsi: true,
  macd: false,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function ChartsScreen() {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [level, setLevel] = useState<LevelRow | null>(null);
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { symbol, timeframe } = prefs;
  const set = useCallback(
    (patch: Partial<Prefs>) =>
      setPrefs((p) => {
        const next = { ...p, ...patch };
        try {
          localStorage.setItem(PREFS_KEY, JSON.stringify(next));
        } catch {
          // preference persistence is best-effort
        }
        return next;
      }),
    [],
  );

  // Load the symbol universe once.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("stocks")
        .select("id, symbol, name, list_type, entry_reference")
        .neq("list_type", "archived")
        .order("symbol", { ascending: true });
      if (error) {
        setErr(error.message);
        return;
      }
      const rows = (data ?? []) as StockRow[];
      setStocks(rows);
      // Keep the remembered symbol when it still exists.
      if (rows.length && !rows.some((r) => r.symbol === prefs.symbol)) {
        set({ symbol: rows[0].symbol });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCandles = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setErr(null);
    const [cRes, lRes, pRes] = await Promise.all([
      supabase
        .from("candles")
        .select("ts, open, high, low, close, volume")
        .eq("symbol", symbol)
        .eq("timeframe", timeframe)
        .order("ts", { ascending: true })
        .limit(2000),
      supabase
        .from("levels")
        .select("support, resistance, support_tests, resistance_tests, trend_context, as_of")
        .eq("symbol", symbol)
        .order("as_of", { ascending: false })
        .limit(1),
      supabase
        .from("watch_plans")
        .select("id, invalidation_line, target_zone_low, target_zone_high")
        .eq("symbol", symbol)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (cRes.error) setErr(cRes.error.message);
    setCandles(
      (cRes.data ?? []).map((r) => ({
        time: Math.floor(new Date(r.ts as string).getTime() / 1000),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: r.volume == null ? null : Number(r.volume),
      })),
    );
    setLevel((lRes.data?.[0] as LevelRow) ?? null);
    setPlan((pRes.data?.[0] as PlanRow) ?? null);
    setLoading(false);
  }, [symbol, timeframe]);

  useEffect(() => {
    void loadCandles();
  }, [loadCandles]);

  const currentStock = useMemo(
    () => stocks.find((s) => s.symbol === symbol) ?? null,
    [stocks, symbol],
  );

  async function handleRefresh() {
    if (!symbol) return;
    setBusy("refresh");
    setErr(null);
    setMsg(null);
    try {
      const r = await callSwing<{ inserted: number }>("ingest_candles", {
        symbol,
        timeframe,
      });
      setMsg(`Fetched ${r.inserted} candles from Kite.`);
      await loadCandles();
    } catch (e) {
      setErr(marketDataHint(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleSyncInstruments() {
    setBusy("sync");
    setErr(null);
    setMsg(null);
    try {
      const r = await callSwing<{ count: number }>("sync_instruments");
      setMsg(`Synced ${r.count} NSE instruments.`);
    } catch (e) {
      setErr(marketDataHint(e));
    } finally {
      setBusy(null);
    }
  }

  // CSV import runs entirely in the browser — no Kite token, no server needed.
  async function handleCsv(file: File) {
    if (!symbol) return;
    setBusy("csv");
    setErr(null);
    setMsg(null);
    try {
      const text = await file.text();
      const r = await importCandleCsv(text, symbol, timeframe);
      setMsg(
        `Imported ${r.inserted} candles${r.skipped ? ` · ${r.skipped} malformed rows skipped` : ""}.`,
      );
      await loadCandles();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const overlays: Overlay[] = useMemo(() => {
    const list: Overlay[] = [];
    if (level?.support != null) {
      list.push({
        price: Number(level.support),
        label: `S ${level.support_tests ?? 0}×`,
        color: "#1baf7a",
        style: "dashed",
      });
    }
    if (level?.resistance != null) {
      list.push({
        price: Number(level.resistance),
        label: `R ${level.resistance_tests ?? 0}×`,
        color: "#e34948",
        style: "dashed",
      });
    }
    if (plan?.invalidation_line != null) {
      list.push({
        price: Number(plan.invalidation_line),
        label: "invalidation",
        color: "#eda100",
        style: "solid",
      });
    }
    const target = plan?.target_zone_low ?? plan?.target_zone_high;
    if (target != null) {
      list.push({
        price: Number(target),
        label: "target",
        color: "#8b5cf6",
        style: "dotted",
      });
    }
    if (currentStock?.entry_reference != null) {
      list.push({
        price: Number(currentStock.entry_reference),
        label: "entry ref",
        color: "#2a78d6",
        style: "dotted",
      });
    }
    return list;
  }, [level, plan, currentStock]);

  const last = candles.length ? candles[candles.length - 1] : null;
  const prev = candles.length > 1 ? candles[candles.length - 2] : null;
  const change = last && prev ? last.close - prev.close : 0;
  const changePct = last && prev && prev.close ? (change / prev.close) * 100 : 0;

  const toLine =
    last && plan?.invalidation_line != null
      ? distanceToLinePct(last.close, Number(plan.invalidation_line))
      : null;

  const INDICATORS: { key: keyof Prefs; label: string; color: string }[] = [
    { key: "ma20", label: "MA20", color: "#eda100" },
    { key: "ma50", label: "MA50", color: "#2a78d6" },
    { key: "ma200", label: "MA200", color: "#8b5cf6" },
    { key: "ema9", label: "EMA9", color: "#e8e8ec" },
    { key: "bb", label: "BB(20,2)", color: "#9898a6" },
    { key: "vwap", label: "VWAP", color: "#e34948" },
    { key: "rsi", label: "RSI(14)", color: "#8b5cf6" },
    { key: "macd", label: "MACD", color: "#2a78d6" },
  ];

  return (
    <>
      <PageHeader
        title="Charts"
        subtitle="Candlesticks · indicators · level overlays"
        actions={
          last ? (
            <div className="font-mono text-sm flex gap-3 items-baseline">
              <span className="text-foreground">₹{last.close.toFixed(2)}</span>
              <span className={change >= 0 ? "text-bullish" : "text-bearish"}>
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)} ({changePct.toFixed(2)}%)
              </span>
            </div>
          ) : undefined
        }
      />
      <PageBody>
        <div className="space-y-3">
          {/* Symbol + timeframe + data actions */}
          <div className="surface p-3 flex flex-wrap items-center gap-2.5">
            <select
              value={symbol}
              onChange={(e) => set({ symbol: e.target.value })}
              className="bg-surface-raised border border-border rounded-md px-3 py-1.5 text-sm font-mono"
            >
              {stocks.length === 0 && <option value="">No stocks — add some first</option>}
              {stocks.map((s) => (
                <option key={s.id} value={s.symbol}>
                  {s.symbol} {s.name ? `· ${s.name}` : ""}
                </option>
              ))}
            </select>

            <div className="flex gap-1">
              {TFS.map((t) => (
                <button
                  key={t}
                  onClick={() => set({ timeframe: t })}
                  className={
                    "text-xs px-2.5 py-1 rounded border transition-colors " +
                    (timeframe === t
                      ? "bg-accent-info/15 border-accent-info text-foreground"
                      : "border-border text-muted-fg hover:text-foreground")
                  }
                >
                  {t}
                </button>
              ))}
            </div>

            <button
              onClick={handleRefresh}
              disabled={busy !== null || !symbol}
              className="btn-primary hover:btn-primary-hover text-xs disabled:opacity-60"
            >
              {busy === "refresh" ? "Fetching…" : "Refresh from Kite"}
            </button>

            <label className="text-xs px-2.5 py-1 rounded border border-border text-muted-fg hover:text-foreground cursor-pointer">
              {busy === "csv" ? "Importing…" : "Upload CSV"}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleCsv(f);
                  e.target.value = "";
                }}
                disabled={busy !== null}
              />
            </label>

            <button
              onClick={handleSyncInstruments}
              disabled={busy !== null}
              className="text-xs px-2.5 py-1 rounded border border-border text-muted-fg hover:text-foreground disabled:opacity-60"
              title="Fetches the NSE instrument list from Kite — run once, or when a symbol isn't found"
            >
              {busy === "sync" ? "Syncing…" : "Sync instruments"}
            </button>

            <span className="ml-auto text-[11px] text-faint font-mono">{candles.length} bars</span>
          </div>

          {/* Indicator toggles */}
          <div className="surface p-2.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-faint uppercase tracking-widest text-[10px] mr-1">
              Indicators
            </span>
            {INDICATORS.map(({ key, label, color }) => {
              const on = Boolean(prefs[key]);
              return (
                <button
                  key={key}
                  onClick={() => set({ [key]: !on } as Partial<Prefs>)}
                  aria-pressed={on}
                  className={
                    "px-2 py-1 rounded border transition-colors " +
                    (on
                      ? "border-border-strong text-foreground bg-surface-raised"
                      : "border-border text-faint hover:text-muted-fg")
                  }
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                    style={{ background: color, opacity: on ? 1 : 0.3 }}
                  />
                  {label}
                </button>
              );
            })}
          </div>

          {msg && <div className="text-xs text-bullish px-1">{msg}</div>}
          {err && <div className="text-xs text-bearish px-1 whitespace-pre-wrap">{err}</div>}

          {/* Chart */}
          <div className="surface overflow-hidden">
            {!symbol ? (
              <div className="p-12 text-center text-sm text-muted-fg">
                Add a symbol on the{" "}
                <Link to="/stocks" className="text-accent-info hover:underline">
                  Stocks screen
                </Link>{" "}
                to begin.
              </div>
            ) : loading && candles.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-fg animate-pulse">
                Loading {symbol}…
              </div>
            ) : candles.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <p className="text-sm text-foreground">
                  No {timeframe} candles stored for {symbol} yet.
                </p>
                <p className="text-xs text-muted-fg">
                  Press “Refresh from Kite” (needs today's token in Settings), or upload a CSV — CSV
                  import works without Kite.
                </p>
              </div>
            ) : (
              <Suspense
                fallback={
                  <div className="p-12 text-center text-sm text-muted-fg">Loading chart…</div>
                }
              >
                <CandleChart
                  candles={candles}
                  overlays={overlays}
                  symbol={symbol}
                  timeframe={timeframe}
                  fitKey={`${symbol}:${timeframe}`}
                  showMA={{
                    ma20: prefs.ma20,
                    ma50: prefs.ma50,
                    ma200: prefs.ma200,
                    ema9: prefs.ema9,
                  }}
                  showBB={prefs.bb}
                  showVWAP={prefs.vwap}
                  showRSI={prefs.rsi}
                  showMACD={prefs.macd}
                  height={520}
                />
              </Suspense>
            )}
          </div>

          {/* Descriptive context strip — measurements, never advice */}
          {(level || plan) && (
            <div className="surface p-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs font-mono">
              {level?.trend_context && (
                <span>
                  <span className="text-faint uppercase tracking-widest mr-1.5">Trend</span>
                  <span
                    className={
                      level.trend_context === "DOWNTREND" ? "text-warning" : "text-foreground"
                    }
                  >
                    {level.trend_context}
                  </span>
                </span>
              )}
              {level?.support != null && (
                <span>
                  <span className="text-faint uppercase tracking-widest mr-1.5">S</span>
                  <span className="text-bullish">₹{Number(level.support).toFixed(2)}</span>
                  <span className="text-muted-fg"> · {level.support_tests ?? 0}× tested</span>
                </span>
              )}
              {level?.resistance != null && (
                <span>
                  <span className="text-faint uppercase tracking-widest mr-1.5">R</span>
                  <span className="text-bearish">₹{Number(level.resistance).toFixed(2)}</span>
                  <span className="text-muted-fg"> · {level.resistance_tests ?? 0}× tested</span>
                </span>
              )}
              {toLine != null && (
                <span>
                  <span className="text-faint uppercase tracking-widest mr-1.5">Line</span>
                  <span className={toLine <= 0 ? "text-warning" : "text-foreground"}>
                    {Math.abs(toLine).toFixed(1)}% {toLine <= 0 ? "beyond" : "above"}
                  </span>
                </span>
              )}
              {level?.as_of && <span className="text-faint">levels as of {level.as_of}</span>}
            </div>
          )}

          <div className="text-[11px] text-faint">
            CSV format: <code className="text-muted-fg">timestamp,open,high,low,close,volume</code>{" "}
            · timestamps as ISO 8601 (e.g.{" "}
            <code className="text-muted-fg">2026-07-24T09:15:00+05:30</code>). Malformed rows are
            skipped and counted, never imported as zeros.
          </div>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}
