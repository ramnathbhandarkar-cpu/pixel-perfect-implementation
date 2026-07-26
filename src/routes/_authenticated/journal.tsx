import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { withCache, writeOrQueue } from "@/lib/offline";

export const Route = createFileRoute("/_authenticated/journal")({
  head: () => ({
    meta: [
      { title: "Journal · Swing Trade" },
      { name: "description", content: "Dated notes linked to positions." },
    ],
  }),
  component: JournalScreen,
});

interface Entry {
  id: string;
  entry_date: string;
  title: string | null;
  body: string | null;
  mood: string | null;
  tags: string[] | null;
  linked_position_id: string | null;
}

interface PositionOption {
  id: string;
  symbol: string;
  entry_at: string;
  status: string;
}

const istTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });

function JournalScreen() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [positions, setPositions] = useState<PositionOption[]>([]);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const result = await withCache("journal", async () => {
        const [eRes, pRes] = await Promise.all([
          supabase.from("journal").select("*").order("entry_date", { ascending: false }).limit(500),
          supabase
            .from("positions")
            .select("id, symbol, entry_at, status")
            .order("entry_at", { ascending: false })
            .limit(100),
        ]);
        if (eRes.error) throw new Error(eRes.error.message);
        if (pRes.error) throw new Error(pRes.error.message);
        return {
          entries: (eRes.data ?? []) as Entry[],
          positions: (pRes.data ?? []) as PositionOption[],
        };
      });
      setEntries(result.data.entries);
      setPositions(result.data.positions);
      setCachedAt(result.cachedAt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(entry: Entry) {
    if (!confirm("Delete this journal entry?")) return;
    try {
      const outcome = await writeOrQueue("delete", "journal", null, { id: entry.id });
      setEntries((list) => list.filter((e) => e.id !== entry.id));
      if (outcome === "queued") setMsg("Offline — deletion queued, will sync when online.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <PageHeader
        title="Journal"
        subtitle="Dated notes, linked to trades"
        actions={
          <button
            onClick={() => setEditing("new")}
            className="btn-primary hover:btn-primary-hover text-xs"
          >
            <Plus size={13} className="inline -mt-0.5 mr-1" />
            New entry
          </button>
        }
      />
      <PageBody>
        <div className="space-y-4 max-w-3xl">
          {cachedAt && (
            <div className="text-xs px-3 py-2 rounded border bg-warning/10 text-warning border-warning/40">
              Offline — showing cached data as of {istTime(cachedAt)}. Edits are queued and sync
              when the connection returns.
            </div>
          )}
          {err && <div className="text-xs text-bearish">{err}</div>}
          {msg && <div className="text-xs text-muted-fg">{msg}</div>}

          {editing && (
            <EntryForm
              entry={editing === "new" ? null : editing}
              positions={positions}
              onQueued={() => setMsg("Offline — entry queued, will sync when online.")}
              onDone={() => {
                setEditing(null);
                void load();
              }}
              onCancel={() => setEditing(null)}
            />
          )}

          {loading ? (
            <div className="text-sm text-muted-fg">Loading…</div>
          ) : entries.length === 0 && !editing ? (
            <div className="surface p-10 text-center space-y-2">
              <p className="text-base text-foreground">No journal entries yet.</p>
              <p className="text-sm text-muted-fg">
                The journal is where lessons compound. Write what you saw, what you did, and what
                you would repeat or avoid.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((e) => {
                const pos = positions.find((p) => p.id === e.linked_position_id);
                return (
                  <div key={e.id} className="surface p-4">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-xs text-faint">{e.entry_date}</span>
                      {e.title && (
                        <span className="text-sm font-medium text-foreground">{e.title}</span>
                      )}
                      {pos && (
                        <span className="text-[11px] font-mono text-accent-info">
                          {pos.symbol} · {pos.entry_at.slice(0, 10)}
                        </span>
                      )}
                      {e.mood && <span className="text-[11px] text-muted-fg">{e.mood}</span>}
                      <span className="ml-auto flex gap-1">
                        <button
                          onClick={() => setEditing(e)}
                          className="text-muted-fg hover:text-foreground p-1"
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => remove(e)}
                          className="text-muted-fg hover:text-bearish p-1"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    </div>
                    {e.body && (
                      <p className="text-sm text-muted-fg mt-2 whitespace-pre-wrap">{e.body}</p>
                    )}
                    {e.tags && e.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {e.tags.map((t) => (
                          <span
                            key={t}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-border text-faint font-mono"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}

function EntryForm({
  entry,
  positions,
  onQueued,
  onDone,
  onCancel,
}: {
  entry: Entry | null;
  positions: PositionOption[];
  onQueued: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(entry?.entry_date ?? new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState(entry?.title ?? "");
  const [body, setBody] = useState(entry?.body ?? "");
  const [mood, setMood] = useState(entry?.mood ?? "");
  const [tags, setTags] = useState((entry?.tags ?? []).join(", "));
  const [positionId, setPositionId] = useState(entry?.linked_position_id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const values = {
      entry_date: date,
      title: title.trim() || null,
      body: body.trim() || null,
      mood: mood.trim() || null,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      linked_position_id: positionId || null,
    };
    try {
      const outcome = entry
        ? await writeOrQueue("update", "journal", values, { id: entry.id })
        : await writeOrQueue("insert", "journal", values);
      if (outcome === "queued") onQueued();
      onDone();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="surface p-4 space-y-3 border-accent-info/40">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {entry ? "Edit entry" : "New entry"}
        </h2>
        <button type="button" onClick={onCancel} className="text-muted-fg hover:text-foreground">
          <X size={15} />
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs text-muted-fg">Date</span>
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            type="date"
            required
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="block col-span-1 md:col-span-2">
          <span className="text-xs text-muted-fg">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-fg">Mood</span>
          <input
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            className="mt-1 w-full bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-sm"
            placeholder="calm / restless / …"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-muted-fg">Notes</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="mt-1 w-full bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
        />
      </label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-muted-fg">Tags (comma-separated)</span>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-sm"
            placeholder="patience, breakout, mistake"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-fg">Linked position</span>
          <select
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-sm"
          >
            <option value="">None</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.symbol} · {p.entry_at.slice(0, 10)} · {p.status}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="btn-primary hover:btn-primary-hover disabled:opacity-60"
      >
        {busy ? "Saving…" : entry ? "Save changes" : "Add entry"}
      </button>
      {err && <span className="text-xs text-bearish ml-3">{err}</span>}
    </form>
  );
}
