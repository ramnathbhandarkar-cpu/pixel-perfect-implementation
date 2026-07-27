import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { TradingViewChart } from "@/components/tradingview-chart";
import { supabase } from "@/integrations/supabase/client";
import { distanceToLinePct } from "@/lib/discipline";
import {
  normaliseSymbol,
  recentSymbols,
  rememberSymbol,
  searchSymbols,
  type SymbolHit,
} from "@/lib/symbols";
import type { Candle, Overlay } from "@/components/candle-chart";

const CandleChart = lazy(() =>
  import("@/components/candle-chart").then((m) => ({ default: m.CandleChart })),
);

export const Route = createFileRoute("/_authenticated/charts")({
  head: () => ({
    meta: [
      { title: "Charts · Swing Trade" },
      { name: "description", content: "Any NSE symbol, with your levels beside it." },
    ],
  }),
  ssr: false,
  component: ChartsScreen,
});

type Timeframe = "15m" | "1h" | "1d" | "1wk";
const TFS: { key: Timeframe; label: string; tv: string }[] = [
  { key: "15m", label: "15m", tv: "15" },
  { key: "1h", label: "1h", tv: "60" },
  { key: "1d", label: "1d", tv: "D" },
  { key: "1wk", label: "1wk", tv: "W" },
];

interface LevelRow {
  support: number | null;
  resistance: number | null;
  support_tests: number | null;
  resistance_tests: number | null;
  trend_context: string | null;
  as_of: string;
}

interface PlanRow {
  invalidation_line: number;
  target_zone_low: number | null;
  target_zone_high: number | null;
}

const PREFS_KEY = "swing-chart-prefs";

interface ChartPrefs {
  symbol: string;
  timeframe: Timeframe;
  view: "tv" | "levels";
}

function loadPrefs(): ChartPrefs {
  const fallback: ChartPrefs = { symbol: "", timeframe: "1d", view: "tv" };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<ChartPrefs>;
    return {
      symbol: p.symbol ?? "",
      timeframe: (p.timeframe as Timeframe) ?? "1d",
      view: p.view === "levels" ? "levels" : "tv",
    };
  } catch {
    return fallback;
  }
}

const inr = (v: number | null | undefined) => (v == null ? "—" : `₹${Number(v).toFixed(2)}`);

function ChartsScreen() {
  const [prefs, setPrefs] = useState(loadPrefs);
  const { symbol, timeframe, view } = prefs;

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SymbolHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [level, setLevel] = useState<LevelRow | null>(null);
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [lastClose, setLastClose] = useState<{ close: number; ts: string } | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loadingLevels, setLoadingLevels] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const set = useCallback((patch: Partial<ChartPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // preferences are a convenience
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setRecents(recentSymbols());
    if (!prefs.symbol) {
      const r = recentSymbols();
      set({ symbol: r[0] ?? "RELIANCE" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Type-ahead, debounced so every keystroke doesn't hit the database.
  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      void searchSymbols(query).then(setHits);
    }, 160);
    return () => clearTimeout(t);
  }, [query]);

  const pick = useCallback(
    (raw: string) => {
      const s = normaliseSymbol(raw);
      if (!s) return;
      rememberSymbol(s);
      setRecents(recentSymbols());
      set({ symbol: s });
      setQuery("");
      setHits([]);
      setSearchOpen(false);
    },
    [set],
  );

  // Our computed context for whatever symbol is on screen.
  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    setLoadingLevels(true);
    (async () => {
      const [lRes, pRes, cRes] = await Promise.all([
        supabase
          .from("levels")
          .select("support, resistance, support_tests, resistance_tests, trend_context, as_of")
          .eq("symbol", symbol)
          .order("as_of", { ascending: false })
          .limit(1),
        supabase
          .from("watch_plans")
          .select("invalidation_line, target_zone_low, target_zone_high")
          .eq("symbol", symbol)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("candles")
          .select("ts, open, high, low, close, volume")
          .eq("symbol", symbol)
          .eq("timeframe", timeframe)
          .order("ts", { ascending: true })
          .limit(2000),
      ]);
      if (!alive) return;
      setLevel((lRes.data?.[0] as LevelRow) ?? null);
      setPlan((pRes.data?.[0] as PlanRow) ?? null);
      const rows = (cRes.data ?? []).map((r) => ({
        time: Math.floor(new Date(r.ts as string).getTime() / 1000),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: r.volume == null ? null : Number(r.volume),
      }));
      setCandles(rows);
      setLastClose(
        rows.length
          ? {
              close: rows[rows.length - 1].close,
              ts: new Date(rows[rows.length - 1].time * 1000).toISOString(),
            }
          : null,
      );
      setLoadingLevels(false);
    })();
    return () => {
      alive = false;
    };
  }, [symbol, timeframe]);

  const overlays: Overlay[] = useMemo(() => {
    const list: Overlay[] = [];
    if (level?.support != null) {
      list.push({
        price: Number(level.support),
        label: `Support ${level.support_tests ?? 0}×`,
        color: "#1baf7a",
        style: "dashed",
      });
    }
    if (level?.resistance != null) {
      list.push({
        price: Number(level.resistance),
        label: `Resistance ${level.resistance_tests ?? 0}×`,
        color: "#e34948",
        style: "dashed",
      });
    }
    if (plan?.invalidation_line != null) {
      list.push({
        price: Number(plan.invalidation_line),
        label: "your exit level",
        color: "#eda100",
        style: "solid",
      });
    }
    return list;
  }, [level, plan]);

  const priceNow = lastClose?.close ?? null;
  const toLine =
    priceNow != null && plan?.invalidation_line != null
      ? distanceToLinePct(priceNow, Number(plan.invalidation_line))
      : null;
  const tvInterval = TFS.find((t) => t.key === timeframe)?.tv ?? "D";

  return (
    <>
      <PageHeader
        title={symbol || "Charts"}
        subtitle="Any NSE stock — just search for it"
        actions={
          <button
            onClick={() => {
              setSearchOpen(true);
              setTimeout(() => searchRef.current?.focus(), 30);
            }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground"
          >
            <Search size={13} /> Search
          </button>
        }
      />
      <PageBody>
        <div className="space-y-3">
          {/* Search — the only way in, no watchlist gating */}
          {searchOpen && (
            <div className="surface p-3">
              <div className="flex items-center gap-2">
                <Search size={14} className="text-faint shrink-0" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") pick(hits[0]?.symbol ?? query);
                    if (e.key === "Escape") setSearchOpen(false);
                  }}
                  placeholder="Type any NSE symbol — RELIANCE, ITC, MAZDOCK…"
                  className="flex-1 bg-transparent text-sm outline-none font-mono"
                />
                <button
                  onClick={() => setSearchOpen(false)}
                  aria-label="Close search"
                  className="text-muted-fg hover:text-foreground p-1"
                >
                  <X size={14} />
                </button>
              </div>
              {hits.length > 0 && (
                <ul className="mt-2 border-t border-border pt-2 space-y-0.5 max-h-72 overflow-y-auto">
                  {hits.map((h) => (
                    <li key={h.symbol}>
                      <button
                        onClick={() => pick(h.symbol)}
                        className="w-full text-left px-2 py-2 rounded hover:bg-surface-raised flex items-baseline gap-2"
                      >
                        <span className="font-mono text-sm text-foreground">{h.symbol}</span>
                        {h.name && <span className="text-xs text-muted-fg truncate">{h.name}</span>}
                        {h.source === "recent" && (
                          <span className="ml-auto text-[10px] text-faint uppercase">recent</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Recents — one tap back to something you were just looking at */}
          {!searchOpen && recents.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {recents.map((r) => (
                <button
                  key={r}
                  onClick={() => pick(r)}
                  className={
                    "text-xs font-mono px-2.5 py-1 rounded border transition-colors " +
                    (r === symbol
                      ? "border-accent-info bg-accent-info/15 text-foreground"
                      : "border-border text-muted-fg hover:text-foreground")
                  }
                >
                  {r}
                </button>
              ))}
            </div>
          )}

          {/* Timeframe + view switch */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {TFS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => set({ timeframe: t.key })}
                  className={
                    "text-xs px-2.5 py-1.5 rounded border transition-colors " +
                    (timeframe === t.key
                      ? "bg-accent-info/15 border-accent-info text-foreground"
                      : "border-border text-muted-fg hover:text-foreground")
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex gap-1">
              <button
                onClick={() => set({ view: "tv" })}
                className={
                  "text-xs px-2.5 py-1.5 rounded border transition-colors " +
                  (view === "tv"
                    ? "bg-accent-info/15 border-accent-info text-foreground"
                    : "border-border text-muted-fg hover:text-foreground")
                }
              >
                Chart
              </button>
              <button
                onClick={() => set({ view: "levels" })}
                title="Our chart, with your computed support and resistance drawn on it"
                className={
                  "text-xs px-2.5 py-1.5 rounded border transition-colors " +
                  (view === "levels"
                    ? "bg-accent-info/15 border-accent-info text-foreground"
                    : "border-border text-muted-fg hover:text-foreground")
                }
              >
                Levels view
              </button>
            </div>
          </div>

          {/* The chart */}
          <div className="surface overflow-hidden">
            {!symbol ? (
              <div className="p-12 text-center text-sm text-muted-fg">
                Search for a stock to see its chart.
              </div>
            ) : view === "tv" ? (
              <TradingViewChart symbol={symbol} interval={tvInterval} height={560} />
            ) : candles.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <p className="text-sm text-foreground">
                  No stored candles for {symbol} at {timeframe} yet.
                </p>
                <p className="text-xs text-muted-fg">
                  This view draws your computed support and resistance on our own chart, so it needs
                  the nightly data. Switch back to Chart for the live TradingView view.
                </p>
              </div>
            ) : (
              <Suspense
                fallback={<div className="p-12 text-center text-sm text-muted-fg">Loading…</div>}
              >
                <CandleChart
                  candles={candles}
                  overlays={overlays}
                  symbol={symbol}
                  timeframe={timeframe}
                  fitKey={`${symbol}:${timeframe}`}
                  showMA={{ ma20: true, ma50: true, ma200: true, ema9: false }}
                  showRSI
                  height={520}
                />
              </Suspense>
            )}
          </div>

          {/* Your levels — the numbers that matter, always visible */}
          <div className="surface p-4">
            <div className="text-[11px] text-faint uppercase tracking-widest">
              Your levels for {symbol}
            </div>
            {loadingLevels ? (
              <p className="text-sm text-muted-fg mt-2">Loading…</p>
            ) : level == null && plan == null ? (
              <p className="text-sm text-muted-fg mt-2 leading-relaxed">
                Nothing computed for {symbol} yet. Levels are worked out overnight for the stocks in
                your screener list — add {symbol} there if you want it measured.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm font-mono">
                {level?.support != null && (
                  <span>
                    <span className="text-faint">Support </span>
                    <span className="text-bullish">{inr(level.support)}</span>
                    <span className="text-muted-fg"> · {level.support_tests ?? 0}× tested</span>
                  </span>
                )}
                {level?.resistance != null && (
                  <span>
                    <span className="text-faint">Resistance </span>
                    <span className="text-bearish">{inr(level.resistance)}</span>
                    <span className="text-muted-fg"> · {level.resistance_tests ?? 0}× tested</span>
                  </span>
                )}
                {plan?.invalidation_line != null && (
                  <span>
                    <span className="text-faint">You said exit at </span>
                    <span className="text-warning">{inr(plan.invalidation_line)}</span>
                    {toLine != null && (
                      <span className={toLine <= 0 ? "text-warning" : "text-muted-fg"}>
                        {" "}
                        · {Math.abs(toLine).toFixed(1)}% {toLine <= 0 ? "past it" : "above it"}
                      </span>
                    )}
                  </span>
                )}
                {level?.trend_context && (
                  <span>
                    <span className="text-faint">Trend </span>
                    <span
                      className={
                        level.trend_context === "DOWNTREND" ? "text-warning" : "text-foreground"
                      }
                    >
                      {level.trend_context}
                    </span>
                  </span>
                )}
                {lastClose && (
                  <span className="text-faint">
                    close {inr(lastClose.close)} on {lastClose.ts.slice(0, 10)}
                  </span>
                )}
              </div>
            )}
            {view === "tv" && overlays.length > 0 && (
              <p className="text-[11px] text-faint mt-3">
                TradingView can't draw these for us. Draw them once with the horizontal-line tool
                and it will remember them for this symbol — or tap Levels view to see them drawn
                automatically.
              </p>
            )}
          </div>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}
