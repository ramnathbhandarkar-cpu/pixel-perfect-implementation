import { supabase } from "@/integrations/supabase/client";

// Symbol lookup for the chart search box. Any listed NSE symbol should be
// reachable by typing it — no watchlist, no pre-adding, no filters.
//
// Suggestions come from whatever we know (the instrument list if it has been
// synced, otherwise the screener universe and recents), but a symbol that
// matches nothing we know is still accepted: the chart takes any NSE ticker.

const RECENTS_KEY = "swing-recent-symbols";
const MAX_RECENTS = 8;

export interface SymbolHit {
  symbol: string;
  name?: string | null;
  source: "instrument" | "universe" | "recent" | "typed";
}

export function recentSymbols(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function rememberSymbol(symbol: string): void {
  const s = symbol.trim().toUpperCase();
  if (!s) return;
  try {
    const next = [s, ...recentSymbols().filter((r) => r !== s)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // recents are a convenience, never a requirement
  }
}

export function normaliseSymbol(raw: string): string {
  // Accept "nse:reliance", "RELIANCE.NS", " reliance " — all mean RELIANCE.
  return raw.trim().toUpperCase().replace(/^NSE:/, "").replace(/\.NS$/, "").replace(/\s+/g, "");
}

export async function searchSymbols(query: string): Promise<SymbolHit[]> {
  const q = normaliseSymbol(query);
  if (!q) return [];

  const hits = new Map<string, SymbolHit>();

  // Recents first — the fastest way back to something you were just looking at.
  for (const r of recentSymbols()) {
    if (r.startsWith(q)) hits.set(r, { symbol: r, source: "recent" });
  }

  const [instruments, universe] = await Promise.all([
    supabase
      .from("instruments")
      .select("tradingsymbol, name")
      .eq("exchange", "NSE")
      .ilike("tradingsymbol", `${q}%`)
      .order("tradingsymbol")
      .limit(12),
    supabase
      .from("stocks")
      .select("symbol, name")
      .ilike("symbol", `${q}%`)
      .order("symbol")
      .limit(12),
  ]);

  for (const row of instruments.data ?? []) {
    const s = row.tradingsymbol as string;
    if (!hits.has(s)) hits.set(s, { symbol: s, name: row.name as string, source: "instrument" });
  }
  for (const row of universe.data ?? []) {
    const s = row.symbol as string;
    if (!hits.has(s)) hits.set(s, { symbol: s, name: row.name as string, source: "universe" });
  }

  // Whatever they typed is always offered, so no symbol is unreachable just
  // because our tables have not heard of it.
  if (!hits.has(q)) hits.set(q, { symbol: q, source: "typed" });

  return [...hits.values()].slice(0, 12);
}
