import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { writeOrQueue } from "@/lib/offline";

// Shared plan editing, used by the merged Trades screen.

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
  { key: "entry", label: "New entry" },
  { key: "held_position", label: "Something I hold" },
  { key: "re_entry", label: "Getting back in" },
];

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

export function PlanForm({
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
    try {
      if (plan) await writeOrQueue("update", "watch_plans", row, { id: plan.id });
      else await writeOrQueue("insert", "watch_plans", row);
      setBusy(false);
      onDone();
    } catch (e2) {
      setBusy(false);
      setErr(e2 instanceof Error ? e2.message : String(e2));
    }
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

export function ResolveForm({
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
    try {
      await writeOrQueue(
        "update",
        "watch_plans",
        {
          status,
          outcome: outcome.trim(),
          lessons: lessons.trim(),
          resolved_at: new Date().toISOString(),
        },
        { id: plan.id },
      );
      setBusy(false);
      onDone();
    } catch (e2) {
      setBusy(false);
      setErr(e2 instanceof Error ? e2.message : String(e2));
    }
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
