import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { withCache } from "@/lib/offline";
import {
  delayHours,
  distanceToLinePct,
  tradeStats,
  unrealisedPnl,
  type Side,
} from "@/lib/discipline";
import { PlanForm, ResolveForm, type WatchPlan } from "@/components/plan-form";
import { EntryForm, CloseForm, type Position, type LineEvent } from "@/components/position-forms";

// One screen for the whole lifecycle: a plan is written, a position opens,
// it closes, the outcome is recorded. They were three screens; they are one
// idea.
export const Route = createFileRoute("/_authenticated/trades")({
  head: () => ({
    meta: [
      { title: "Trades · Swing Trade" },
      { name: "description", content: "Plans, open positions, and what they cost." },
    ],
  }),
  component: TradesScreen,
});

type Segment = "watching" | "open" | "closed";

interface EventRow {
  id: string;
  position_id: string | null;
  event_type: string;
  detected_at: string;
  acted_at: string | null;
  delay_hours: number | null;
  delay_cost: number | null;
  price_at_detection: number | null;
}

const inr = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : `₹${Number(v).toFixed(digits)}`;
const inr0 = (v: number) => `₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const istTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function TradesScreen() {
  const [segment, setSegment] = useState<Segment>("open");
  const [plans, setPlans] = useState<WatchPlan[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [closes, setCloses] = useState<Map<string, { close: number; ts: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<WatchPlan | "new" | null>(null);
  const [resolvingPlan, setResolvingPlan] = useState<WatchPlan | null>(null);
  const [loggingEntry, setLoggingEntry] = useState(false);
  const [closingPosition, setClosingPosition] = useState<Position | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const result = await withCache("trades", async () => {
        const [pl, po, ev] = await Promise.all([
          supabase.from("watch_plans").select("*").order("created_at", { ascending: false }),
          supabase.from("positions").select("*").order("entry_at", { ascending: false }),
          supabase
            .from("discipline_events")
            .select(
              "id, position_id, event_type, detected_at, acted_at, delay_hours, delay_cost, price_at_detection",
            ),
        ]);
        if (pl.error) throw new Error(pl.error.message);
        if (po.error) throw new Error(po.error.message);
        const planRows = (pl.data ?? []) as WatchPlan[];
        const posRows = (po.data ?? []) as Position[];
        const evRows = (ev.data ?? []) as EventRow[];

        const symbols = [...new Set([...planRows, ...posRows].map((r) => r.symbol))];
        let closeEntries: [string, { close: number; ts: string }][] = [];
        if (symbols.length) {
          const { data } = await supabase
            .from("candles")
            .select("symbol, ts, close")
            .in("timeframe", ["15m", "1d"])
            .in("symbol", symbols)
            .gte("ts", new Date(Date.now() - 21 * 86400 * 1000).toISOString())
            .order("ts", { ascending: false })
            .limit(4000);
          const latest = new Map<string, { close: number; ts: string }>();
          for (const row of data ?? []) {
            if (!latest.has(row.symbol as string)) {
              latest.set(row.symbol as string, {
                close: Number(row.close),
                ts: row.ts as string,
              });
            }
          }
          closeEntries = [...latest.entries()];
        }
        return { planRows, posRows, evRows, closeEntries };
      });
      setPlans(result.data.planRows);
      setPositions(result.data.posRows);
      setEvents(result.data.evRows);
      setCloses(new Map(result.data.closeEntries));
      setCachedAt(result.cachedAt);
    } catch (e) {
      setErr(
        "Couldn't reach your data just now. Anything you enter will be saved and synced when the connection returns.",
      );
      void e;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activePlans = useMemo(() => plans.filter((p) => p.status === "active"), [plans]);
  const openPositions = useMemo(() => positions.filter((p) => p.status === "open"), [positions]);
  const closedPositions = useMemo(
    () => positions.filter((p) => p.status === "closed"),
    [positions],
  );
  const lineEvents = useMemo(() => {
    const m = new Map<string, EventRow>();
    for (const e of events) {
      if (e.event_type === "line_crossed" && e.position_id) m.set(e.position_id, e);
    }
    return m;
  }, [events]);

  const metrics = useMemo(() => {
    const crossed = events.filter((e) => e.event_type === "line_crossed");
    const totalDelay = crossed.reduce(
      (s, e) => s + (e.delay_cost != null && e.delay_cost > 0 ? Number(e.delay_cost) : 0),
      0,
    );
    const honoured = events.filter((e) => e.event_type === "exit_honored").length;
    const delayed = events.filter((e) => e.event_type === "exit_delayed").length;
    const planById = new Map(plans.map((p) => [p.id, p]));
    const withPlan = positions.filter((p) => planById.has(p.plan_id));
    const planBefore = withPlan.filter(
      (p) => new Date(planById.get(p.plan_id)!.created_at) < new Date(p.entry_at),
    ).length;
    const stats = tradeStats(
      closedPositions
        .filter((p) => p.realised_pnl != null)
        .map((p) => ({ realisedPnl: Number(p.realised_pnl) })),
    );
    const resolved = crossed.filter((e) => e.acted_at != null);
    const avgDelay = resolved.length
      ? resolved.reduce((s, e) => s + Number(e.delay_hours ?? 0), 0) / resolved.length
      : null;
    return {
      totalDelay,
      honoured,
      delayed,
      planBefore,
      planTotal: withPlan.length,
      stats,
      avgDelay,
      breaches: crossed.length,
    };
  }, [events, plans, positions, closedPositions]);

  const breached = openPositions.filter((p) => lineEvents.has(p.id));

  return (
    <>
      <PageHeader
        title="Trades"
        subtitle="What you're watching, what you're holding, what it cost"
        actions={
          <button
            onClick={() => (segment === "watching" ? setEditingPlan("new") : setLoggingEntry(true))}
            className="btn-primary hover:btn-primary-hover text-xs"
          >
            <Plus size={13} className="inline -mt-0.5 mr-1" />
            {segment === "watching" ? "Write a plan" : "I bought something"}
          </button>
        }
      />
      <PageBody>
        <div className="space-y-3">
          {cachedAt && (
            <p className="text-xs px-3 py-2 rounded border bg-warning/10 text-warning border-warning/40">
              Showing your data as of {istTime(cachedAt)} — the connection is down. Prices are not
              live. Edits are saved and sync when it returns.
            </p>
          )}
          {err && <p className="text-xs text-muted-fg">{err}</p>}

          {/* Metrics strip — the number is the feedback */}
          <button
            onClick={() => setShowMetrics((v) => !v)}
            className="w-full surface p-3 text-left"
          >
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="flex items-baseline gap-2">
                <span
                  className={
                    "font-mono text-2xl font-semibold " +
                    (metrics.totalDelay > 0 ? "text-bearish" : "text-foreground")
                  }
                >
                  {inr0(metrics.totalDelay)}
                </span>
                <span className="text-xs text-muted-fg">
                  lost by not selling when you said you would
                </span>
              </span>
              <span className="text-xs text-muted-fg font-mono">
                Wrote the plan first {metrics.planBefore}/{metrics.planTotal}
              </span>
              <span className="text-xs text-muted-fg font-mono">
                Sold when you said {metrics.honoured}/{metrics.honoured + metrics.delayed}
              </span>
              <span className="text-xs text-muted-fg font-mono">
                Win rate{" "}
                {metrics.stats.winRate == null
                  ? "—"
                  : `${(metrics.stats.winRate * 100).toFixed(0)}%`}
              </span>
              <span className="ml-auto text-[11px] text-faint">
                {showMetrics ? "hide detail" : "more detail"}
              </span>
            </div>
          </button>

          {showMetrics && (
            <div className="surface p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Metric
                label="Trades finished"
                value={String(metrics.stats.n)}
                note="ones you have sold and written up"
              />
              <Metric
                label="Average wait before selling"
                value={metrics.avgDelay == null ? "—" : `${metrics.avgDelay.toFixed(1)} h`}
                note="from price passing your exit to you actually selling"
              />
              <Metric
                label="Typical win / typical loss"
                value={
                  metrics.stats.avgWin == null
                    ? "—"
                    : `${inr0(metrics.stats.avgWin)} / ${
                        metrics.stats.avgLoss == null ? "—" : inr0(metrics.stats.avgLoss)
                      }`
                }
              />
              <Metric
                label="Average outcome per trade"
                value={
                  metrics.stats.expectancy == null
                    ? "—"
                    : `${metrics.stats.expectancy >= 0 ? "" : "−"}${inr0(metrics.stats.expectancy)}`
                }
                note="at the rate and sizes you have been trading"
              />
            </div>
          )}

          {/* Breaches ride above everything */}
          {breached.map((p) => {
            const ev = lineEvents.get(p.id)!;
            return (
              <div
                key={p.id}
                className="bg-bearish/15 border border-bearish/50 rounded-lg px-4 py-3"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="text-bearish mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="text-foreground font-medium">
                      <span className="font-mono">{p.symbol}</span> went past the price you said
                      you'd exit at.
                    </p>
                    <p className="text-muted-fg text-xs mt-0.5 font-mono">
                      You said {inr(p.invalidation_at_entry)} · it was {inr(ev.price_at_detection)}{" "}
                      on {istTime(ev.detected_at)} ·{" "}
                      {delayHours(ev.detected_at, new Date()).toFixed(1)} hours ago
                    </p>
                    <button
                      onClick={() => setClosingPosition(p)}
                      className="mt-2 text-xs px-3 py-1.5 rounded border border-bearish/50 text-foreground hover:bg-bearish/10"
                    >
                      Close this position
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Segments */}
          <div className="flex gap-1 border-b border-border">
            {(
              [
                ["watching", `Watching (${activePlans.length})`],
                ["open", `Open (${openPositions.length})`],
                ["closed", `Closed (${closedPositions.length})`],
              ] as [Segment, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSegment(key)}
                className={
                  "px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors " +
                  (segment === key
                    ? "border-accent-info text-foreground"
                    : "border-transparent text-muted-fg hover:text-foreground")
                }
              >
                {label}
              </button>
            ))}
          </div>

          {/* Forms */}
          {editingPlan && (
            <PlanForm
              plan={editingPlan === "new" ? null : editingPlan}
              onDone={() => {
                setEditingPlan(null);
                void load();
              }}
              onCancel={() => setEditingPlan(null)}
            />
          )}
          {resolvingPlan && (
            <ResolveForm
              plan={resolvingPlan}
              onDone={() => {
                setResolvingPlan(null);
                void load();
              }}
              onCancel={() => setResolvingPlan(null)}
            />
          )}
          {loggingEntry && (
            <EntryForm
              plans={activePlans}
              onDone={() => {
                setLoggingEntry(false);
                void load();
              }}
              onCancel={() => setLoggingEntry(false)}
            />
          )}
          {closingPosition && (
            <CloseForm
              position={closingPosition}
              lineEvent={(lineEvents.get(closingPosition.id) as LineEvent) ?? null}
              onDone={() => {
                setClosingPosition(null);
                void load();
              }}
              onCancel={() => setClosingPosition(null)}
            />
          )}

          {loading ? (
            <p className="text-sm text-muted-fg">Loading…</p>
          ) : segment === "watching" ? (
            activePlans.length === 0 ? (
              <Empty
                title="No plans yet."
                body="A plan is where you write your exit level before you buy. That is the whole point of this app — decide while you are calm, not while you are losing money."
              />
            ) : (
              <div className="space-y-2">
                {activePlans.map((p) => (
                  <PlanRow
                    key={p.id}
                    plan={p}
                    close={closes.get(p.symbol) ?? null}
                    onEdit={() => setEditingPlan(p)}
                    onResolve={() => setResolvingPlan(p)}
                  />
                ))}
              </div>
            )
          ) : segment === "open" ? (
            openPositions.length === 0 ? (
              <Empty
                title="Nothing open."
                body={
                  activePlans.length > 0
                    ? "When you buy, log it here and pick the plan you wrote. The exit level comes across with it."
                    : "Write a plan first — you cannot log a position without one, on purpose."
                }
              />
            ) : (
              <div className="space-y-2">
                {openPositions.map((p) => (
                  <OpenRow
                    key={p.id}
                    position={p}
                    close={closes.get(p.symbol) ?? null}
                    breached={lineEvents.has(p.id)}
                    onClose={() => setClosingPosition(p)}
                  />
                ))}
              </div>
            )
          ) : closedPositions.length === 0 ? (
            <Empty
              title="Nothing closed yet."
              body="Closed trades collect here with what each one actually cost, including anything lost by waiting after your exit level broke."
            />
          ) : (
            <div className="surface overflow-x-auto">
              <table className="data w-full text-sm whitespace-nowrap">
                <thead className="text-[11px] uppercase tracking-widest text-faint">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 font-medium">Stock</th>
                    <th className="num px-3 py-2 font-medium">Bought</th>
                    <th className="num px-3 py-2 font-medium">Sold</th>
                    <th className="num px-3 py-2 font-medium">Result</th>
                    <th className="num px-3 py-2 font-medium">Lost to waiting</th>
                    <th className="text-left px-3 py-2 font-medium">Why you exited</th>
                  </tr>
                </thead>
                <tbody>
                  {closedPositions.map((p) => {
                    const ev = lineEvents.get(p.id);
                    const delay = ev?.delay_cost != null ? Number(ev.delay_cost) : null;
                    return (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-mono font-medium">{p.symbol}</td>
                        <td className="num px-3 py-2">{inr(p.entry_price)}</td>
                        <td className="num px-3 py-2">{inr(p.exit_price)}</td>
                        <td
                          className={
                            "num px-3 py-2 font-medium " +
                            ((p.realised_pnl ?? 0) >= 0 ? "text-bullish" : "text-bearish")
                          }
                        >
                          {inr(p.realised_pnl, 0)}
                        </td>
                        <td className="num px-3 py-2 text-warning">
                          {delay != null && delay > 0 ? inr0(delay) : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-fg text-xs">{p.exit_reason ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="text-[11px] text-faint uppercase tracking-widest">{label}</div>
      <div className="font-mono text-lg font-semibold text-foreground mt-1">{value}</div>
      {note && <div className="text-[11px] text-muted-fg mt-0.5">{note}</div>}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="surface p-10 text-center space-y-2">
      <p className="text-base text-foreground">{title}</p>
      <p className="text-sm text-muted-fg max-w-md mx-auto leading-relaxed">{body}</p>
    </div>
  );
}

function PlanRow({
  plan,
  close,
  onEdit,
  onResolve,
}: {
  plan: WatchPlan;
  close: { close: number; ts: string } | null;
  onEdit: () => void;
  onResolve: () => void;
}) {
  const dist =
    close != null ? distanceToLinePct(close.close, Number(plan.invalidation_line)) : null;
  const past = dist != null && dist <= 0;
  return (
    <div className="surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono font-semibold">{plan.symbol}</span>
        <span className="text-xs text-muted-fg font-mono">
          exit at <span className="text-warning">{inr(plan.invalidation_line)}</span>
        </span>
        {close && <span className="text-xs text-muted-fg font-mono">now {inr(close.close)}</span>}
        {dist != null && (
          <span
            className={
              "text-sm font-mono font-semibold " + (past ? "text-warning" : "text-foreground")
            }
          >
            {Math.abs(dist).toFixed(1)}% {past ? "past your exit" : "above your exit"}
          </span>
        )}
        <span className="ml-auto flex gap-2">
          <button onClick={onEdit} className="text-xs text-muted-fg hover:text-foreground">
            Edit
          </button>
          <button
            onClick={onResolve}
            className="text-xs px-2 py-1 rounded border border-border text-muted-fg hover:text-foreground"
          >
            Close plan
          </button>
        </span>
      </div>
      {plan.context && <p className="text-sm text-muted-fg mt-2">{plan.context}</p>}
    </div>
  );
}

function OpenRow({
  position: p,
  close,
  breached,
  onClose,
}: {
  position: Position;
  close: { close: number; ts: string } | null;
  breached: boolean;
  onClose: () => void;
}) {
  const upnl = close
    ? unrealisedPnl(Number(p.entry_price), p.qty, close.close, p.side as Side)
    : null;
  const dist = close
    ? distanceToLinePct(close.close, Number(p.invalidation_at_entry), p.side as Side)
    : null;
  return (
    <div className={"surface p-4 " + (breached ? "border-bearish/60" : "")}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono font-semibold">{p.symbol}</span>
        <span className="text-[11px] text-faint uppercase">
          {p.qty} @ {inr(p.entry_price)}
        </span>
        {close && <span className="text-xs text-muted-fg font-mono">now {inr(close.close)}</span>}
        {upnl != null && (
          <span
            className={
              "text-sm font-mono font-semibold " + (upnl >= 0 ? "text-bullish" : "text-bearish")
            }
          >
            {upnl >= 0 ? "+" : ""}
            {inr(upnl, 0)}
          </span>
        )}
        <button
          onClick={onClose}
          className="ml-auto text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground"
        >
          Close
        </button>
      </div>
      <div className="mt-2 text-xs font-mono text-muted-fg">
        You said exit at <span className="text-warning">{inr(p.invalidation_at_entry)}</span>
        {dist != null && (
          <span className={dist <= 0 ? "text-warning" : ""}>
            {" "}
            · {Math.abs(dist).toFixed(1)}% {dist <= 0 ? "past it" : "above it"}
          </span>
        )}
      </div>
    </div>
  );
}
