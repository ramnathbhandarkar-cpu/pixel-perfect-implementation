import { supabase } from "@/integrations/supabase/client";

// Phase 6 — offline support: a read cache plus a queued-write outbox.
// Cached data is always labelled with when it was cached; a cached number
// must never render as if it were live.

const CACHE_PREFIX = "swing-cache:";
const OUTBOX_KEY = "swing-outbox";

export function cachePut(key: string, data: unknown): void {
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ data, cachedAt: new Date().toISOString() }),
    );
  } catch {
    // storage full/unavailable — cache is best-effort
  }
}

export function cacheGet<T>(key: string): { data: T; cachedAt: string } | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as { data: T; cachedAt: string };
  } catch {
    return null;
  }
}

export interface CachedResult<T> {
  data: T;
  // null when live; the cache timestamp when served offline
  cachedAt: string | null;
}

// Run a live fetch; on failure fall back to the last cached copy (labelled).
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<CachedResult<T>> {
  try {
    const data = await fetcher();
    cachePut(key, data);
    return { data, cachedAt: null };
  } catch (e) {
    const hit = cacheGet<T>(key);
    if (hit) return { data: hit.data, cachedAt: hit.cachedAt };
    throw e;
  }
}

// ── outbox ───────────────────────────────────────────────────

export interface QueuedWrite {
  id: string;
  table: string;
  op: "insert" | "update" | "delete";
  values: Record<string, unknown> | null;
  match: Record<string, unknown> | null;
  queuedAt: string;
}

function readOutbox(): QueuedWrite[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]") as QueuedWrite[];
  } catch {
    return [];
  }
}

function writeOutbox(items: QueuedWrite[]): void {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
}

export function outboxCount(): number {
  return readOutbox().length;
}

const isNetworkError = (message: string) =>
  /fetch|network|Failed to|NetworkError|load failed/i.test(message);

async function runWrite(
  w: QueuedWrite,
): Promise<{ ok: boolean; retryable: boolean; message?: string }> {
  const table = supabase.from(w.table);
  const q =
    w.op === "insert"
      ? table.insert(w.values ?? {})
      : w.op === "update"
        ? table.update(w.values ?? {}).match(w.match ?? {})
        : table.delete().match(w.match ?? {});
  const { error } = await q;
  if (!error) return { ok: true, retryable: false };
  return { ok: false, retryable: isNetworkError(error.message), message: error.message };
}

// Try the write now; queue it if the network is down. Returns how it ended.
export async function writeOrQueue(
  op: QueuedWrite["op"],
  table: string,
  values: Record<string, unknown> | null,
  match: Record<string, unknown> | null = null,
): Promise<"written" | "queued"> {
  const w: QueuedWrite = {
    id: crypto.randomUUID(),
    table,
    op,
    values,
    match,
    queuedAt: new Date().toISOString(),
  };
  if (typeof navigator !== "undefined" && navigator.onLine) {
    const r = await runWrite(w);
    if (r.ok) return "written";
    if (!r.retryable) throw new Error(r.message);
  }
  writeOutbox([...readOutbox(), w]);
  return "queued";
}

// Flush queued writes in order. Stops at the first network failure (keeps
// the rest queued); drops writes the database permanently rejects so one
// bad row cannot block the queue forever.
export async function flushOutbox(): Promise<{
  flushed: number;
  dropped: string[];
  remaining: number;
}> {
  let items = readOutbox();
  let flushed = 0;
  const dropped: string[] = [];
  while (items.length > 0) {
    if (typeof navigator !== "undefined" && !navigator.onLine) break;
    const w = items[0];
    const r = await runWrite(w);
    if (r.ok) {
      flushed += 1;
      items = items.slice(1);
      writeOutbox(items);
    } else if (r.retryable) {
      break;
    } else {
      dropped.push(`${w.op} ${w.table}: ${r.message ?? "rejected"}`);
      items = items.slice(1);
      writeOutbox(items);
    }
  }
  return { flushed, dropped, remaining: items.length };
}
