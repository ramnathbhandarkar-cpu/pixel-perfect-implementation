import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { tradeStats, tradesPerWeek } from "@/lib/discipline";

export const Route = createFileRoute("/_authenticated/scorecard")({
  head: () => ({
    meta: [
      { title: "Scorecard · Swing Trade" },
      { name: "description", content: "Discipline metrics including cost of delay." },
    ],
  }),
  component: ScorecardScreen,
});

interface PositionRow {
  id: string;
  plan_id: string;
  status: "open" | "closed";
  entry_at: string;
  realised_pnl: number | null;
}

interface EventRow {
  id: string;
  position_id: string | null;
  event_type: string;
  detected_at: string;
  acted_at: string | null;
  delay_hours: number | null;
  delay_cost: number | null;
}

interface PlanRow {
  id: string;
  plan_type: string;
  created_at: string;
}

const inr0 = (v: number) => `₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function ScorecardScreen() {
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [plans, setPlans] = useState<Map<string, PlanRow>>(new Map());
  const [baseline, setBaseline] = useState<number | null>(null);
  const [baselineInput, setBaselineInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [posRes, evRes, planRes, setRes] = await Promise.all([
      supabase.from("positions").select("id, plan_id, status, entry_at, realised_pnl"),
      supabase
        .from("discipline_events")
        .select("id, position_id, event_type, detected_at, acted_at, delay_hours, delay_cost"),
      supabase.from("watch_plans").select("id, plan_type, created_at"),
      supabase.from("settings").select("value").eq("key", "trade_frequency_baseline").maybeSingle(),
    ]);
    if (posRes.error) setErr(posRes.error.message);
    setPositions((posRes.data ?? []) as PositionRow[]);
    setEvents((evRes.data ?? []) as EventRow[]);
    setPlans(new Map(((planRes.data ?? []) as PlanRow[]).map((p) => [p.id, p])));
    const b = setRes.data?.value?.per_week;
    setBaseline(typeof b === "number" ? b : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveBaseline() {
    const v = Number(baselineInput);
    if (!(v > 0)) return;
    const { error } = await supabase
      .from("settings")
      .upsert(
        { key: "trade_frequency_baseline", value: { per_week: v } },
        { onConflict: "user_id,key" },
      );
    if (error) setErr(error.message);
    else {
      setBaseline(v);
      setBaselineInput("");
    }
  }

  const m = useMemo(() => {
    const lineEvents = events.filter((e) => e.event_type === "line_crossed");
    const resolvedLine = lineEvents.filter((e) => e.acted_at != null);
    const honored = events.filter((e) => e.event_type === "exit_honored").length;
    const delayed = events.filter((e) => e.event_type === "exit_delayed").length;

    const totalDelayCost = lineEvents.reduce(
      (s, e) => s + (e.delay_cost != null && e.delay_cost > 0 ? Number(e.delay_cost) : 0),
      0,
    );
    const avgDelayHours = resolvedLine.length
      ? resolvedLine.reduce((s, e) => s + Number(e.delay_hours ?? 0), 0) / resolvedLine.length
      : null;

    const withPlanTimes = positions.filter((p) => plans.has(p.plan_id));
    const planBefore = withPlanTimes.filter(
      (p) => new Date(plans.get(p.plan_id)!.created_at) < new Date(p.entry_at),
    ).length;
    const planBeforeRate = withPlanTimes.length ? planBefore / withPlanTimes.length : null;

    const closed = positions.filter((p) => p.status === "closed" && p.realised_pnl != null);
    const stats = tradeStats(closed.map((p) => ({ realisedPnl: Number(p.realised_pnl) })));
    const perWeek = tradesPerWeek(positions.map((p) => p.entry_at));

    const byType = new Map<string, { n: number; total: number }>();
    for (const p of closed) {
      const t = plans.get(p.plan_id)?.plan_type ?? "unknown";
      const cur = byType.get(t) ?? { n: 0, total: 0 };
      cur.n += 1;
      cur.total += Number(p.realised_pnl);
      byType.set(t, cur);
    }
    const typeRows = [...byType.entries()]
      .map(([t, v]) => ({ type: t, n: v.n, total: v.total, avg: v.total / v.n }))
      .sort((a, b) => b.avg - a.avg);

    return {
      totalDelayCost,
      lineEventCount: lineEvents.length,
      honored,
      delayed,
      honoredRate: honored + delayed > 0 ? honored / (honored + delayed) : null,
      avgDelayHours,
      planBeforeRate,
      stats,
      perWeek,
      typeRows,
    };
  }, [positions, events, plans]);

  const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
  const runningHot = baseline != null && m.perWeek != null && m.perWeek > baseline;

  return (
    <>
      <PageHeader title="Scorecard" subtitle="Measurement, not judgement" />
      <PageBody>
        {loading ? (
          <div className="text-sm text-muted-fg">Loading…</div>
        ) : (
          <div className="space-y-4 max-w-4xl">
            {err && <div className="text-xs text-bearish">{err}</div>}

            {/* The number this app exists to shrink. Largest element on the page. */}
            <div className="surface p-6">
              <div className="text-[11px] text-faint uppercase tracking-widest">
                Total ₹ lost to delay — cumulative
              </div>
              <div
                className={
                  "font-mono font-semibold tracking-tight mt-2 text-5xl md:text-6xl " +
                  (m.totalDelayCost > 0 ? "text-bearish" : "text-foreground")
                }
              >
                {inr0(m.totalDelayCost)}
              </div>
              <p className="text-xs text-muted-fg mt-3">
                Money given up between the moment an invalidation line broke and the actual exit —
                across every closed breach.{" "}
                {m.lineEventCount === 0
                  ? "No line has been crossed yet."
                  : `${m.lineEventCount} breach${m.lineEventCount === 1 ? "" : "es"} recorded.`}
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Metric
                label="Plan before entry"
                value={pct(m.planBeforeRate)}
                note="positions entered with a pre-existing plan"
              />
              <Metric
                label="Line honoured"
                value={pct(m.honoredRate)}
                note={`breaches exited within one session (${m.honored} of ${m.honored + m.delayed})`}
              />
              <Metric
                label="Average delay"
                value={m.avgDelayHours == null ? "—" : `${m.avgDelayHours.toFixed(1)} h`}
                note="from breach detection to exit"
              />
              <Metric
                label="Trades per week"
                value={m.perWeek == null ? "—" : m.perWeek.toFixed(1)}
                note={
                  baseline == null
                    ? "no baseline set"
                    : `baseline ${baseline.toFixed(1)}/wk${runningHot ? " — running hot" : ""}`
                }
                warn={runningHot}
              />
              <Metric label="Closed trades" value={String(m.stats.n)} />
              <Metric label="Win rate" value={pct(m.stats.winRate)} />
              <Metric
                label="Avg win / avg loss"
                value={
                  m.stats.avgWin == null
                    ? "—"
                    : `${inr0(m.stats.avgWin)} / ${m.stats.avgLoss == null ? "—" : inr0(m.stats.avgLoss)}`
                }
              />
              <Metric
                label="Expectancy"
                value={
                  m.stats.expectancy == null
                    ? "—"
                    : `${m.stats.expectancy >= 0 ? "" : "−"}${inr0(m.stats.expectancy)}`
                }
                note="expected ₹ per trade at current rates"
              />
            </div>

            {m.typeRows.length > 0 && (
              <div className="surface p-4">
                <div className="text-[11px] text-faint uppercase tracking-widest">
                  Closed P&L by plan type
                </div>
                <table className="data w-full text-sm mt-2">
                  <thead className="text-[11px] uppercase tracking-widest text-faint">
                    <tr className="border-b border-border">
                      <th className="text-left px-2 py-1.5 font-medium">Plan type</th>
                      <th className="num px-2 py-1.5 font-medium">Trades</th>
                      <th className="num px-2 py-1.5 font-medium">Total P&L</th>
                      <th className="num px-2 py-1.5 font-medium">Avg / trade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.typeRows.map((r) => (
                      <tr key={r.type} className="border-b border-border last:border-0">
                        <td className="px-2 py-1.5">{r.type.replace("_", " ")}</td>
                        <td className="num px-2 py-1.5">{r.n}</td>
                        <td
                          className={
                            "num px-2 py-1.5 " + (r.total >= 0 ? "text-bullish" : "text-bearish")
                          }
                        >
                          {r.total >= 0 ? "" : "−"}
                          {inr0(r.total)}
                        </td>
                        <td
                          className={
                            "num px-2 py-1.5 " + (r.avg >= 0 ? "text-bullish" : "text-bearish")
                          }
                        >
                          {r.avg >= 0 ? "" : "−"}
                          {inr0(r.avg)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="surface p-4">
              <div className="text-[11px] text-faint uppercase tracking-widest">
                Trade-frequency baseline
              </div>
              <p className="text-xs text-muted-fg mt-1.5">
                Your most profitable historical pace, in trades per week. The scorecard turns amber
                when the current pace runs above it — overtrading is surfaced as a warning, never a
                streak.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={baselineInput}
                  onChange={(e) => setBaselineInput(e.target.value)}
                  type="number"
                  min="0.1"
                  step="0.1"
                  placeholder={baseline?.toString() ?? "e.g. 1.5"}
                  className="w-28 font-mono bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-sm"
                />
                <button
                  onClick={saveBaseline}
                  className="text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground"
                >
                  Save baseline
                </button>
              </div>
            </div>
          </div>
        )}
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}

function Metric({
  label,
  value,
  note,
  warn,
}: {
  label: string;
  value: string;
  note?: string;
  warn?: boolean;
}) {
  return (
    <div className="surface p-4">
      <div className="text-[11px] text-faint uppercase tracking-widest">{label}</div>
      <div
        className={
          "font-mono text-xl font-semibold mt-1.5 " + (warn ? "text-warning" : "text-foreground")
        }
      >
        {value}
      </div>
      {note && <div className="text-[11px] text-muted-fg mt-1">{note}</div>}
    </div>
  );
}
