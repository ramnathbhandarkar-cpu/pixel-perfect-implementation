import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { callSwing } from "@/lib/swing-api";
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
        content: "Candlestick charts with MA/BB/RSI/VWAP indicators and level overlays.",
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
}

function ChartsScreen() {
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [symbol, setSymbol] = useState<string>("");
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [level, setLevel] = useState<LevelRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showMA20, setShowMA20] = useState(true);
  const [showMA50, setShowMA50] = useState(true);
  const [showMA200, setShowMA200] = useState(true);
  const [showEMA9, setShowEMA9] = useState(false);
  const [showBB, setShowBB] = useState(false);
  const [showVWAP, setShowVWAP] = useState(false);
  const [showRSI, setShowRSI] = useState(true);

  // Load active stocks for symbol switcher
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
      if (rows.length && !symbol) setSymbol(rows[0].symbol);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentStock = useMemo(
    () => stocks.find((s) => s.symbol === symbol) ?? null,
    [stocks, symbol],
  );

  // Load candles + latest level for the current symbol/timeframe
  async function loadCandles() {
    if (!symbol) return;
    setLoading(true);
    setErr(null);
    const [cRes, lRes] = await Promise.all([
      supabase
        .from("candles")
        .select("ts, open, high, low, close, volume")
        .eq("symbol", symbol)
        .eq("timeframe", timeframe)
        .order("ts", { ascending: true })
        .limit(2000),
      supabase
        .from("levels")
        .select("support, resistance, support_tests, resistance_tests, trend_context")
        .eq("symbol", symbol)
        .order("as_of", { ascending: false })
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
    setLoading(false);
  }

  useEffect(() => {
    if (symbol) void loadCandles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe]);

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
      setMsg(`Ingested ${r.inserted} candles.`);
      await loadCandles();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleCsv(file: File) {
    if (!symbol) return;
    setBusy("csv");
    setErr(null);
    setMsg(null);
    try {
      const text = await file.text();
      const r = await callSwing<{ inserted: number }>("ingest_csv", {
        symbol,
        timeframe,
        csv: text,
      });
      setMsg(`Imported ${r.inserted} candles from CSV.`);
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
        label: `S · ${level.support_tests ?? 0}× tested`,
        color: "#1baf7a",
        style: "dashed",
      });
    }
    if (level?.resistance != null) {
      list.push({
        price: Number(level.resistance),
        label: `R · ${level.resistance_tests ?? 0}× tested`,
        color: "#e34948",
        style: "dashed",
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
  }, [level, currentStock]);

  const last = candles.length ? candles[candles.length - 1] : null;
  const prev = candles.length > 1 ? candles[candles.length - 2] : null;
  const change = last && prev ? last.close - prev.close : 0;
  const changePct = last && prev ? (change / prev.close) * 100 : 0;

  return (
    <>
      <PageHeader title="Charts" subtitle="Candlesticks · indicators · level overlays" />
      <PageBody>
        <div className="space-y-4">
          {/* Symbol + timeframe controls */}
          <div className="surface p-3 flex flex-wrap items-center gap-3">
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
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
                  onClick={() => setTimeframe(t)}
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
              title="Fetches NSE instruments list from Kite — run once, or when a symbol isn't found"
            >
              {busy === "sync" ? "Syncing…" : "Sync instruments"}
            </button>

            {last && (
              <div className="ml-auto font-mono text-sm flex gap-3 items-baseline">
                <span className="text-foreground">₹{last.close.toFixed(2)}</span>
                <span className={change >= 0 ? "text-bullish" : "text-bearish"}>
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(2)} ({changePct.toFixed(2)}%)
                </span>
              </div>
            )}
          </div>

          {/* Indicator toggles */}
          <div className="surface p-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-faint uppercase tracking-widest">Indicators</span>
            {(
              [
                ["MA20", showMA20, setShowMA20, "#eda100"],
                ["MA50", showMA50, setShowMA50, "#2a78d6"],
                ["MA200", showMA200, setShowMA200, "#8b5cf6"],
                ["EMA9", showEMA9, setShowEMA9, "#e8e8ec"],
                ["BB(20,2)", showBB, setShowBB, "#9898a6"],
                ["VWAP", showVWAP, setShowVWAP, "#e34948"],
                ["RSI(14)", showRSI, setShowRSI, "#8b5cf6"],
              ] as const
            ).map(([label, val, set, color]) => (
              <button
                key={label}
                onClick={() => set(!val)}
                className={
                  "px-2 py-1 rounded border transition-colors " +
                  (val
                    ? "border-border text-foreground bg-surface-raised"
                    : "border-border text-faint hover:text-muted-fg")
                }
              >
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                  style={{ background: color, opacity: val ? 1 : 0.3 }}
                />
                {label}
              </button>
            ))}
          </div>

          {msg && <div className="text-xs text-bullish px-1">{msg}</div>}
          {err && <div className="text-xs text-bearish px-1">{err}</div>}

          {/* Chart */}
          <div className="surface p-3">
            {!symbol ? (
              <div className="p-12 text-center text-sm text-muted-fg">
                Add a symbol on the Stocks screen to begin.
              </div>
            ) : candles.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-fg">
                {loading
                  ? "Loading…"
                  : `No candles for ${symbol} · ${timeframe}. Press "Refresh from Kite" (make sure your Kite token is set in Settings), or upload a CSV.`}
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
                  showMA={{
                    ma20: showMA20,
                    ma50: showMA50,
                    ma200: showMA200,
                    ema9: showEMA9,
                  }}
                  showBB={showBB}
                  showVWAP={showVWAP}
                  showRSI={showRSI}
                  height={560}
                />
              </Suspense>
            )}
          </div>

          {/* Level context strip */}
          {level && (
            <div className="surface p-3 flex flex-wrap gap-4 text-xs font-mono">
              {level.trend_context && (
                <span>
                  <span className="text-faint uppercase tracking-widest mr-1">Trend</span>
                  <span
                    className={
                      level.trend_context === "DOWNTREND" ? "text-warning" : "text-foreground"
                    }
                  >
                    {level.trend_context}
                  </span>
                </span>
              )}
              {level.support != null && (
                <span>
                  <span className="text-faint uppercase tracking-widest mr-1">S</span>
                  <span className="text-bullish">₹{Number(level.support).toFixed(2)}</span>
                  <span className="text-muted-fg"> · {level.support_tests ?? 0}× tested</span>
                </span>
              )}
              {level.resistance != null && (
                <span>
                  <span className="text-faint uppercase tracking-widest mr-1">R</span>
                  <span className="text-bearish">₹{Number(level.resistance).toFixed(2)}</span>
                  <span className="text-muted-fg"> · {level.resistance_tests ?? 0}× tested</span>
                </span>
              )}
            </div>
          )}

          <div className="text-[11px] text-faint">
            CSV format: <code className="text-muted-fg">timestamp,open,high,low,close,volume</code>.
            Timestamps as ISO 8601 (e.g.{" "}
            <code className="text-muted-fg">2026-07-24T09:15:00+05:30</code>).
          </div>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}
