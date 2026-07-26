import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { distanceToLinePct } from "@/lib/discipline";
import { Pencil, Plus, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/plans")({
  head: () => ({
    meta: [
      { title: "Plans · Swing Trade" },
      { name: "description", content: "Watch plans with written invalidation lines." },
    ],
  }),
  component: PlansScreen,
});

export interface ConditionItem {
  text: string;
  checked: boolean;
  checked_at: string | null;
}

export interface WatchPlan {
  id: string;
  symbol: string;
  status: "active" | "resolved" | "faded";
  plan_type: "entry" | "held_position" | "re_entry";
  context: string | null;
  entry_zone_low: number | null;
  entry_zone_high: number | null;
  invalidation_line: number;
  target_zone_low: number | null;
  target_zone_high: number | null;
  bullish_conditions: ConditionItem[];
  bearish_conditions: ConditionItem[];
  caveat: string | null;
  created_at: string;
  resolved_at: string | null;
  outcome: string | null;
  lessons: string | null;
}

const PLAN_TYPES: { key: WatchPlan["plan_type"]; label: string }[] = [
  { key: "entry", label: "Entry" },
  { key: "held_position", label: "Held position" },
  { key: "re_entry", label: "Re-entry" },
];

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const inr = (v: number | null | undefined) => (v == null ? "—" : `₹${Number(v).toFixed(2)}`);

function PlansScreen() {
  const [plans, setPlans] = useState<WatchPlan[]>([]);
  const [closes, setCloses] = useState<Map<string, { close: number; ts: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<WatchPlan | "new" | null>(null);
  const [resolving, setResolving] = useState<WatchPlan | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("watch_plans")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      setErr(error.message);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as WatchPlan[];
    setPlans(rows);
    const symbols = [...new Set(rows.map((p) => p.symbol))];
    if (symbols.length) {
      const cutoff = new Date(Date.now() - 21 * 86400 * 1000).toISOString();
      const { data: candleRows } = await supabase
        .from("candles")
        .select("symbol, ts, close")
        .eq("timeframe", "1d")
        .in("symbol", symbols)
        .gte("ts", cutoff)
        .order("ts", { ascending: false })
        .limit(2000);
      const latest = new Map<string, { close: number; ts: string }>();
      for (const row of candleRows ?? []) {
        if (!latest.has(row.symbol as string)) {
          latest.set(row.symbol as string, {
            close: Number(row.close),
            ts: row.ts as string,
          });
        }
      }
      setCloses(latest);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleCondition(
    plan: WatchPlan,
    kind: "bullish_conditions" | "bearish_conditions",
    index: number,
  ) {
    const list = plan[kind].map((c, i) =>
      i === index
        ? {
            ...c,
            checked: !c.checked,
            checked_at: !c.checked ? new Date().toISOString() : null,
          }
        : c,
    );
    const { error } = await supabase
      .from("watch_plans")
      .update({ [kind]: list })
      .eq("id", plan.id);
    if (error) setErr(error.message);
    else void load();
  }

  const active = useMemo(() => plans.filter((p) => p.status === "active"), [plans]);
  const settled = useMemo(() => plans.filter((p) => p.status !== "active"), [plans]);

  return (
    <>
      <PageHeader
        title="Plans"
        subtitle="A plan must exist before a position exists"
        actions={
          <button
            onClick={() => setEditing("new")}
            className="btn-primary hover:btn-primary-hover text-xs"
          >
            <Plus size={13} className="inline -mt-0.5 mr-1" />
            New plan
          </button>
        }
      />
      <PageBody>
        <div className="space-y-4">
          {err && <div className="text-xs text-bearish">{err}</div>}

          {editing && (
            <PlanForm
              plan={editing === "new" ? null : editing}
              onDone={() => {
                setEditing(null);
                void load();
              }}
              onCancel={() => setEditing(null)}
            />
          )}

          {resolving && (
            <ResolveForm
              plan={resolving}
              onDone={() => {
                setResolving(null);
                void load();
              }}
              onCancel={() => setResolving(null)}
            />
          )}

          {loading ? (
            <div className="text-sm text-muted-fg">Loading…</div>
          ) : active.length === 0 && !editing ? (
            <div className="surface p-10 text-center space-y-2">
              <p className="text-base text-foreground">No active plans.</p>
              <p className="text-sm text-muted-fg">
                Every position starts here: write the plan — including the price at which you are
                wrong — before any entry.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {active.map((p) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  close={closes.get(p.symbol) ?? null}
                  onEdit={() => setEditing(p)}
                  onResolve={() => setResolving(p)}
                  onToggle={(kind, i) => void toggleCondition(p, kind, i)}
                />
              ))}
            </div>
          )}

          {settled.length > 0 && (
            <details className="mt-6">
              <summary className="text-xs text-faint uppercase tracking-widest cursor-pointer">
                Resolved / faded ({settled.length})
              </summary>
              <div className="mt-3 space-y-2">
                {settled.map((p) => (
                  <div key={p.id} className="surface p-3 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono font-medium">{p.symbol}</span>
                      <span className="text-[11px] text-faint uppercase">{p.status}</span>
                      <span className="text-xs text-muted-fg">line {inr(p.invalidation_line)}</span>
                      {p.resolved_at && (
                        <span className="text-xs text-faint">
                          {new Date(p.resolved_at).toLocaleDateString("en-IN")}
                        </span>
                      )}
                    </div>
                    {p.outcome && (
                      <p className="text-xs text-muted-fg mt-1">
                        <span className="text-faint">Outcome:</span> {p.outcome}
                      </p>
                    )}
                    {p.lessons && (
                      <p className="text-xs text-muted-fg mt-0.5">
                        <span className="text-faint">Lessons:</span> {p.lessons}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}

function PlanCard({
  plan,
  close,
  onEdit,
  onResolve,
  onToggle,
}: {
  plan: WatchPlan;
  close: { close: number; ts: string } | null;
  onEdit: () => void;
  onResolve: () => void;
  onToggle: (kind: "bullish_conditions" | "bearish_conditions", index: number) => void;
}) {
  const dist =
    close != null ? distanceToLinePct(close.close, Number(plan.invalidation_line)) : null;
  const breached = dist != null && dist <= 0;
  return (
    <div className="surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono font-semibold text-base">{plan.symbol}</span>
        <span className="text-[11px] text-faint uppercase tracking-widest">
          {PLAN_TYPES.find((t) => t.key === plan.plan_type)?.label}
        </span>
        <span className="text-xs text-muted-fg font-mono">
          line <span className="text-foreground">{inr(plan.invalidation_line)}</span>
        </span>
        {close && (
          <span className="text-xs text-muted-fg font-mono">
            now <span className="text-foreground">{inr(close.close)}</span>
            <span className="text-faint"> · {close.ts.slice(0, 10)}</span>
          </span>
        )}
        {dist != null && (
          <span
            className={
              "text-sm font-mono font-semibold " + (breached ? "text-warning" : "text-foreground")
            }
          >
            {Math.abs(dist).toFixed(1)}% {breached ? "BEYOND line" : "above line"}
          </span>
        )}
        <span className="ml-auto flex gap-1">
          <button
            onClick={onEdit}
            className="text-muted-fg hover:text-foreground p-1"
            title="Edit plan"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onResolve}
            className="text-xs px-2 py-1 rounded border border-border text-muted-fg hover:text-foreground"
          >
            Resolve
          </button>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-fg font-mono">
        {(plan.entry_zone_low != null || plan.entry_zone_high != null) && (
          <span>
            entry {inr(plan.entry_zone_low)}–{inr(plan.entry_zone_high)}
          </span>
        )}
        {(plan.target_zone_low != null || plan.target_zone_high != null) && (
          <span>
            target {inr(plan.target_zone_low)}–{inr(plan.target_zone_high)}
          </span>
        )}
        <span className="text-faint">
          created {new Date(plan.created_at).toLocaleDateString("en-IN")}
        </span>
      </div>

      {plan.context && <p className="text-sm text-muted-fg mt-2">{plan.context}</p>}
      {plan.caveat && <p className="text-xs text-warning mt-1">Caveat: {plan.caveat}</p>}

      {(plan.bullish_conditions.length > 0 || plan.bearish_conditions.length > 0) && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <ConditionList
            title="Bullish conditions"
            items={plan.bullish_conditions}
            onToggle={(i) => onToggle("bullish_conditions", i)}
          />
          <ConditionList
            title="Bearish conditions"
            items={plan.bearish_conditions}
            onToggle={(i) => onToggle("bearish_conditions", i)}
          />
        </div>
      )}
    </div>
  );
}

function ConditionList({
  title,
  items,
  onToggle,
}: {
  title: string;
  items: ConditionItem[];
  onToggle: (index: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] text-faint uppercase tracking-widest">{title}</div>
      <ul className="mt-1.5 space-y-1">
        {items.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={c.checked}
              onChange={() => onToggle(i)}
              className="mt-1 accent-[#2a78d6]"
            />
            <span className={c.checked ? "text-foreground" : "text-muted-fg"}>
              {c.text}
              {c.checked && c.checked_at && (
                <span className="text-faint text-xs">
                  {" "}
                  · {new Date(c.checked_at).toLocaleDateString("en-IN")}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConditionEditor({
  label,
  items,
  setItems,
}: {
  label: string;
  items: ConditionItem[];
  setItems: (items: ConditionItem[]) => void;
}) {
  return (
    <div>
      <div className="text-xs text-muted-fg">{label}</div>
      <div className="mt-1.5 space-y-1.5">
        {items.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={c.text}
              onChange={(e) =>
                setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
              }
              className="flex-1 bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-sm"
              placeholder="Condition…"
            />
            <button
              type="button"
              onClick={() => setItems(items.filter((_, j) => j !== i))}
              className="text-muted-fg hover:text-bearish p-1"
              title="Remove"
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setItems([...items, { text: "", checked: false, checked_at: null }])}
          className="text-xs text-muted-fg hover:text-foreground border border-border rounded px-2 py-1"
        >
          + Add condition
        </button>
      </div>
    </div>
  );
}

function PlanForm({
  plan,
  onDone,
  onCancel,
}: {
  plan: WatchPlan | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [stocks, setStocks] = useState<string[]>([]);
  const [symbol, setSymbol] = useState(plan?.symbol ?? "");
  const [planType, setPlanType] = useState<WatchPlan["plan_type"]>(plan?.plan_type ?? "entry");
  const [context, setContext] = useState(plan?.context ?? "");
  const [entryLow, setEntryLow] = useState(plan?.entry_zone_low?.toString() ?? "");
  const [entryHigh, setEntryHigh] = useState(plan?.entry_zone_high?.toString() ?? "");
  const [invalidation, setInvalidation] = useState(plan?.invalidation_line?.toString() ?? "");
  const [targetLow, setTargetLow] = useState(plan?.target_zone_low?.toString() ?? "");
  const [targetHigh, setTargetHigh] = useState(plan?.target_zone_high?.toString() ?? "");
  const [bullish, setBullish] = useState<ConditionItem[]>(plan?.bullish_conditions ?? []);
  const [bearish, setBearish] = useState<ConditionItem[]>(plan?.bearish_conditions ?? []);
  const [caveat, setCaveat] = useState(plan?.caveat ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("stocks")
        .select("symbol, list_type, is_active")
        .neq("list_type", "archived")
        .eq("is_active", true)
        .order("symbol");
      setStocks([...new Set((data ?? []).map((r) => r.symbol as string))]);
    })();
  }, []);

  const canSubmit = symbol.trim() !== "" && invalidation.trim() !== "" && !busy;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const row = {
      symbol: symbol.trim().toUpperCase(),
      plan_type: planType,
      context: context.trim() || null,
      entry_zone_low: num(entryLow),
      entry_zone_high: num(entryHigh),
      invalidation_line: Number(invalidation),
      target_zone_low: num(targetLow),
      target_zone_high: num(targetHigh),
      bullish_conditions: bullish.filter((c) => c.text.trim() !== ""),
      bearish_conditions: bearish.filter((c) => c.text.trim() !== ""),
      caveat: caveat.trim() || null,
    };
    const q = plan
      ? supabase.from("watch_plans").update(row).eq("id", plan.id)
      : supabase.from("watch_plans").insert(row);
    const { error } = await q;
    setBusy(false);
    if (error) setErr(error.message);
    else onDone();
  }

  return (
    <form onSubmit={save} className="surface p-4 space-y-4 border-accent-info/40">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {plan ? `Edit plan — ${plan.symbol}` : "New watch plan"}
        </h2>
        <button type="button" onClick={onCancel} className="text-muted-fg hover:text-foreground">
          <X size={15} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs text-muted-fg">Symbol *</span>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
            required
          >
            <option value="">Select…</option>
            {stocks.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted-fg">Plan type</span>
          <select
            value={planType}
            onChange={(e) => setPlanType(e.target.value as WatchPlan["plan_type"])}
            className="mt-1 w-full bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          >
            {PLAN_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-warning">Invalidation line (₹) * — required</span>
          <input
            value={invalidation}
            onChange={(e) => setInvalidation(e.target.value)}
            type="number"
            step="0.05"
            min="0"
            required
            className="mt-1 w-full font-mono bg-surface-raised border border-warning/40 rounded-md px-2.5 py-2 text-sm"
            placeholder="The price at which you are wrong"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs text-muted-fg">Entry zone low</span>
          <input
            value={entryLow}
            onChange={(e) => setEntryLow(e.target.value)}
            type="number"
            step="0.05"
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-fg">Entry zone high</span>
          <input
            value={entryHigh}
            onChange={(e) => setEntryHigh(e.target.value)}
            type="number"
            step="0.05"
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-fg">Target zone low</span>
          <input
            value={targetLow}
            onChange={(e) => setTargetLow(e.target.value)}
            type="number"
            step="0.05"
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-fg">Target zone high</span>
          <input
            value={targetHigh}
            onChange={(e) => setTargetHigh(e.target.value)}
            type="number"
            step="0.05"
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs text-muted-fg">Context — why this setup</span>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={2}
          className="mt-1 w-full bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
        />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ConditionEditor label="Bullish conditions" items={bullish} setItems={setBullish} />
        <ConditionEditor label="Bearish conditions" items={bearish} setItems={setBearish} />
      </div>

      <label className="block">
        <span className="text-xs text-muted-fg">Caveat</span>
        <input
          value={caveat}
          onChange={(e) => setCaveat(e.target.value)}
          className="mt-1 w-full bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          placeholder="What would make this plan wrong even before the line?"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary hover:btn-primary-hover disabled:opacity-60"
        >
          {busy ? "Saving…" : plan ? "Save changes" : "Create plan"}
        </button>
        {!invalidation.trim() && (
          <span className="text-xs text-warning">
            The invalidation line is required — a plan without one is not a plan.
          </span>
        )}
        {err && <span className="text-xs text-bearish">{err}</span>}
      </div>
    </form>
  );
}

function ResolveForm({
  plan,
  onDone,
  onCancel,
}: {
  plan: WatchPlan;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<"resolved" | "faded">("resolved");
  const [outcome, setOutcome] = useState("");
  const [lessons, setLessons] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = outcome.trim() !== "" && lessons.trim() !== "" && !busy;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    const { error } = await supabase
      .from("watch_plans")
      .update({
        status,
        outcome: outcome.trim(),
        lessons: lessons.trim(),
        resolved_at: new Date().toISOString(),
      })
      .eq("id", plan.id);
    setBusy(false);
    if (error) setErr(error.message);
    else onDone();
  }

  return (
    <form onSubmit={save} className="surface p-4 space-y-3 border-warning/40">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Resolve plan — <span className="font-mono">{plan.symbol}</span>
        </h2>
        <button type="button" onClick={onCancel} className="text-muted-fg hover:text-foreground">
          <X size={15} />
        </button>
      </div>
      <p className="text-xs text-muted-fg">
        Outcome and lessons are required — this is how the track record builds.
      </p>
      <div className="flex gap-2">
        {(["resolved", "faded"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={
              "text-xs px-3 py-1.5 rounded border " +
              (status === s
                ? "bg-accent-info/15 border-accent-info text-foreground"
                : "border-border text-muted-fg hover:text-foreground")
            }
          >
            {s === "resolved" ? "Resolved (played out)" : "Faded (setup went away)"}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="text-xs text-muted-fg">Outcome *</span>
        <input
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          required
          className="mt-1 w-full bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          placeholder="What actually happened"
        />
      </label>
      <label className="block">
        <span className="text-xs text-muted-fg">Lessons *</span>
        <textarea
          value={lessons}
          onChange={(e) => setLessons(e.target.value)}
          required
          rows={2}
          className="mt-1 w-full bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          placeholder="What this plan taught you"
        />
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        className="btn-primary hover:btn-primary-hover disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save resolution"}
      </button>
      {err && <span className="text-xs text-bearish ml-3">{err}</span>}
    </form>
  );
}
