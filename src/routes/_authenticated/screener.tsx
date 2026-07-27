import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { computeAndStoreLevels, loadActiveStocks, runAndStoreScreener } from "@/lib/pipeline";
import {
  runScreener,
  sectorClusters,
  type ScreenerEvaluation,
  type ScreenerInput,
} from "@/lib/screener-engine";

export const Route = createFileRoute("/_authenticated/screener")({
  head: () => ({
    meta: [
      { title: "Screener · Swing Trade" },
      {
        name: "description",
        content: "How much room there is above, against how far the floor is below.",
      },
    ],
  }),
  component: ScreenerScreen,
});

interface StockRow {
  symbol: string;
  sector: string | null;
  list_type: string;
  is_active: boolean;
}

interface LevelRow {
  symbol: string;
  as_of: string;
  support: number | null;
  resistance: number | null;
  support_tests: number | null;
  resistance_tests: number | null;
  trend_context: string | null;
  is_downtrend: boolean;
}

interface RunRow {
  run_date: string;
  ran_at: string;
  qualifying: unknown[];
  scanned: number | null;
}

const inr = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : `₹${v.toFixed(digits)}`;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);

function ScreenerScreen() {
  const [inputs, setInputs] = useState<ScreenerInput[]>([]);
  const [missingData, setMissingData] = useState<string[]>([]);
  const [lastRun, setLastRun] = useState<RunRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const stocksRes = await supabase
        .from("stocks")
        .select("symbol, sector, list_type, is_active")
        .neq("list_type", "archived")
        .eq("is_active", true)
        .order("symbol", { ascending: true });
      if (stocksRes.error) throw stocksRes.error;
      const stockMap = new Map<string, StockRow>();
      for (const s of (stocksRes.data ?? []) as StockRow[]) {
        if (!stockMap.has(s.symbol)) stockMap.set(s.symbol, s);
        else if (!stockMap.get(s.symbol)!.sector && s.sector)
          stockMap.get(s.symbol)!.sector = s.sector;
      }
      const symbols = [...stockMap.keys()];
      if (symbols.length === 0) {
        setInputs([]);
        setMissingData([]);
        setLastRun(null);
        return;
      }

      const cutoff = new Date(Date.now() - 21 * 86400 * 1000).toISOString();
      const [levelsRes, closesRes, runRes] = await Promise.all([
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
          .gte("ts", cutoff)
          .order("ts", { ascending: false })
          .limit(5000),
        supabase
          .from("screener_runs")
          .select("run_date, ran_at, qualifying, scanned")
          .order("run_date", { ascending: false })
          .limit(1),
      ]);
      if (levelsRes.error) throw levelsRes.error;
      if (closesRes.error) throw closesRes.error;

      const latestLevel = new Map<string, LevelRow>();
      for (const row of (levelsRes.data ?? []) as LevelRow[]) {
        if (!latestLevel.has(row.symbol)) latestLevel.set(row.symbol, row);
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

      const nextInputs: ScreenerInput[] = [];
      const missing: string[] = [];
      for (const [symbol, stock] of stockMap) {
        const level = latestLevel.get(symbol);
        const close = latestClose.get(symbol);
        if (!level || !close) {
          missing.push(symbol);
          continue;
        }
        nextInputs.push({
          symbol,
          sector: stock.sector,
          price: close.close,
          priceAsOf: close.ts,
          support: level.support == null ? null : Number(level.support),
          supportTests: Number(level.support_tests ?? 0),
          resistance: level.resistance == null ? null : Number(level.resistance),
          resistanceTests: Number(level.resistance_tests ?? 0),
          trendContext: level.trend_context,
          isDowntrend: Boolean(level.is_downtrend),
          levelAsOf: level.as_of,
        });
      }
      setInputs(nextInputs);
      setMissingData(missing);
      setLastRun(((runRes.data ?? [])[0] as RunRow) ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Levels + screener need no secrets, so they run right here against the
  // owner's own rows — no dependency on the market-data function being up.
  async function handleRun() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    setProgress(null);
    try {
      const stocks = await loadActiveStocks();
      if (stocks.length === 0)
        throw new Error("Nothing to measure yet — add stocks under More › Screener universe.");
      const levels = await computeAndStoreLevels(stocks, (done, total, sym) =>
        setProgress(`Working out floors and ceilings ${done}/${total} · ${sym}`),
      );
      setProgress("Measuring…");
      const screener = await runAndStoreScreener(stocks);
      const parts = [
        `Measured ${levels.computed.length} of ${stocks.length} stocks`,
        `${screener.result.qualifying.length} worth a look`,
        `saved for ${screener.runDate}`,
      ];
      if (levels.skippedInsufficientData.length) {
        parts.push(
          `${levels.skippedInsufficientData.length} skipped — fewer than 60 days of price history`,
        );
      }
      if (levels.failed.length) parts.push(`${levels.failed.length} could not be measured`);
      setMsg(`${parts.join(" · ")}.`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  const result = useMemo(() => runScreener(inputs), [inputs]);
  const clusters = useMemo(() => sectorClusters(result.qualifying), [result]);

  const levelAsOf = useMemo(() => {
    const dates = inputs.map((i) => i.levelAsOf).filter(Boolean) as string[];
    return dates.length ? dates.sort().reverse()[0] : null;
  }, [inputs]);
  const oldestClose = useMemo(() => {
    const dates = inputs.map((i) => i.priceAsOf).filter(Boolean) as string[];
    return dates.length ? dates.sort()[0] : null;
  }, [inputs]);
  const staleClose =
    oldestClose != null && Date.now() - new Date(oldestClose).getTime() > 3 * 86400 * 1000;

  return (
    <>
      <PageHeader
        title="Screener"
        subtitle="How much room there is above, against how far the floor is below"
        actions={
          <button
            onClick={handleRun}
            disabled={busy || loading}
            className="btn-primary hover:btn-primary-hover text-xs disabled:opacity-60"
          >
            {busy ? "Measuring…" : "Measure again now"}
          </button>
        }
      />
      <PageBody>
        <div className="space-y-4">
          {/* Run context strip */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-fg font-mono">
            {lastRun && (
              <span>
                Last measured <span className="text-foreground">{lastRun.run_date}</span> ·{" "}
                {Array.isArray(lastRun.qualifying) ? lastRun.qualifying.length : 0} of{" "}
                {lastRun.scanned ?? "—"} worth a look
              </span>
            )}
            {levelAsOf && (
              <span>
                Floors and ceilings worked out <span className="text-foreground">{levelAsOf}</span>
              </span>
            )}
            {oldestClose && (
              <span className={staleClose ? "text-warning" : ""}>
                Prices up to {oldestClose.slice(0, 10)}
                {staleClose ? " — older than 3 days" : ""}
              </span>
            )}
          </div>

          {progress && (
            <div className="text-xs text-muted-fg px-1 font-mono animate-pulse">{progress}</div>
          )}
          {msg && <div className="text-xs text-bullish px-1">{msg}</div>}
          {err && <div className="text-xs text-bearish px-1">{err}</div>}

          {loading ? (
            <div className="text-sm text-muted-fg">Loading…</div>
          ) : inputs.length === 0 && missingData.length === 0 ? (
            <div className="surface p-10 text-center">
              <p className="text-sm text-muted-fg leading-relaxed">
                Nothing is being measured yet. Add the stocks you want watched under More › Screener
                universe, and they'll be measured overnight from then on.
              </p>
            </div>
          ) : (
            <>
              {result.qualifying.length === 0 ? (
                <div className="surface p-10 text-center space-y-2">
                  <p className="text-base text-foreground">Nothing qualifies today.</p>
                  <p className="text-sm text-muted-fg leading-relaxed">
                    That is a normal result, not a failure. Setups worth taking are not a daily
                    occurrence, and the measurements below show what was ruled out and why.
                  </p>
                </div>
              ) : (
                <div className="surface overflow-x-auto">
                  <table className="data w-full text-sm whitespace-nowrap">
                    <thead className="text-[11px] uppercase tracking-widest text-faint">
                      <tr className="border-b border-border">
                        <th className="text-left px-3 py-2 font-medium">Symbol</th>
                        <th className="num px-3 py-2 font-medium">Price</th>
                        <th
                          className="num px-3 py-2 font-medium"
                          title="The price it has bounced off before"
                        >
                          Floor
                        </th>
                        <th
                          className="num px-3 py-2 font-medium"
                          title="The price it has struggled to pass"
                        >
                          Ceiling
                        </th>
                        <th
                          className="num px-3 py-2 font-medium"
                          title="Price now, down to the floor"
                        >
                          Room below
                        </th>
                        <th
                          className="num px-3 py-2 font-medium"
                          title="Price now, up to the ceiling"
                        >
                          Room above
                        </th>
                        <th
                          className="num px-3 py-2 font-medium"
                          title="Room above for every ₹1 of room below"
                        >
                          Above : below
                        </th>
                        <th className="text-left px-3 py-2 font-medium">Direction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.qualifying.map((q) => (
                        <QualifyingRow key={q.symbol} q={q} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sector concentration */}
              {clusters.length > 0 && (
                <div className="surface p-4">
                  <div className="text-[11px] text-faint uppercase tracking-widest">
                    Several of these are in the same business
                  </div>
                  {clusters.map((c) => (
                    <p key={c.sector} className="text-sm text-muted-fg mt-2 leading-relaxed">
                      {c.symbols.length} of them are{" "}
                      <span className="text-foreground">{c.sector}</span>:{" "}
                      <span className="font-mono">{c.symbols.join(", ")}</span>. Stocks in the same
                      sector tend to move together, so taking several is closer to one large bet
                      than to several small ones.
                    </p>
                  ))}
                </div>
              )}

              {/* Rejections, with reasons */}
              {result.rejected.length > 0 && (
                <div className="surface p-4">
                  <div className="text-[11px] text-faint uppercase tracking-widest">
                    Ruled out — {result.rejected.length} of {result.scanned} measured
                  </div>
                  <RejectionGroup
                    label={`${result.rejectedThinSupport} where the floor has barely been tested`}
                    note="A price it has only bounced off once is not a floor yet — it is a recent low nothing has argued with."
                    items={result.rejected.filter((e) => e.rejectionCategory === "thin_support")}
                  />
                  <RejectionGroup
                    label={`${result.rejectedGeometry} where there is less than ₹2 of room above for every ₹1 below`}
                    note="Being right has to pay more than being wrong costs, or the odds have to be extraordinary."
                    items={result.rejected.filter((e) => e.rejectionCategory === "geometry")}
                  />
                  <RejectionGroup
                    label={`${result.rejectedRiskBand} where the floor is either too close or too far`}
                    note="Closer than 1.5% and ordinary daily noise takes you out; further than 8% and it is no longer a one-to-two-week trade."
                    items={result.rejected.filter((e) => e.rejectionCategory === "risk_band")}
                  />
                </div>
              )}

              {missingData.length > 0 && (
                <div className="surface p-4">
                  <div className="text-[11px] text-faint uppercase tracking-widest">
                    Couldn't be measured — {missingData.length}
                  </div>
                  <p className="text-sm text-muted-fg mt-2 leading-relaxed">
                    <span className="font-mono">{missingData.join(", ")}</span>
                    {" — "}there isn't enough recent price history for these yet. They will be
                    picked up on the next overnight run.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}

function QualifyingRow({ q }: { q: ScreenerEvaluation }) {
  return (
    <tr
      className={
        "border-b border-border last:border-0 hover:bg-surface-raised " +
        (q.isDowntrend ? "opacity-80" : "")
      }
    >
      <td className="px-3 py-2 font-mono font-medium">
        {q.symbol}
        {q.sector && <span className="ml-2 text-[10px] text-faint">{q.sector}</span>}
      </td>
      <td className="num px-3 py-2">{inr(q.price)}</td>
      <td className="num px-3 py-2">
        <span className="text-bullish">{inr(q.support)}</span>
        <span className="text-faint"> · {q.supportTests}×</span>
      </td>
      <td className="num px-3 py-2">
        <span className="text-bearish">{inr(q.resistance)}</span>
        <span className="text-faint"> · {q.resistanceTests}×</span>
      </td>
      <td className="num px-3 py-2">
        {inr(q.risk)} <span className="text-faint">({pct(q.riskPct)})</span>
      </td>
      <td className="num px-3 py-2">
        {inr(q.reward)}{" "}
        <span className="text-faint">
          ({q.reward != null ? pct((q.reward / q.price) * 100) : "—"})
        </span>
      </td>
      <td className="num px-3 py-2 font-medium">1:{q.ratio == null ? "—" : q.ratio.toFixed(1)}</td>
      <td className="px-3 py-2">
        {q.isDowntrend ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-warning border border-warning/40 rounded px-1.5 py-0.5">
            <AlertTriangle size={11} />
            {q.trendContext ?? "downtrend"}
          </span>
        ) : (
          <span className="text-[11px] text-muted-fg">{q.trendContext ?? "—"}</span>
        )}
      </td>
    </tr>
  );
}

function RejectionGroup({
  label,
  note,
  items,
}: {
  label: string;
  note?: string;
  items: ScreenerEvaluation[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-sm text-foreground">{label}</p>
      {note && <p className="text-xs text-faint mt-0.5">{note}</p>}
      <p className="text-xs text-muted-fg mt-1 font-mono leading-relaxed">
        {items.map((e, i) => (
          <span key={e.symbol} title={e.rejectionReasons.join("; ")}>
            {i > 0 && ", "}
            {e.symbol}
            <span className="text-faint"> ({e.rejectionReasons[0]})</span>
          </span>
        ))}
      </p>
    </div>
  );
}
