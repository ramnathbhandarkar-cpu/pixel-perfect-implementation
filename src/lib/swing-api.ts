import { supabase } from "@/integrations/supabase/client";

// All Kite/pipeline work happens in the `swing` edge function (service-role,
// server-side). The browser calls it with the signed-in user's JWT — the
// client never sees Kite credentials.
export async function callSwing<T = Record<string, unknown>>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("swing", {
    body: { action, ...payload },
  });
  if (error) {
    let message = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = (await ctx.json()) as { error?: string };
        if (j?.error) message = j.error;
      } catch {
        // keep the generic message
      }
    }
    throw new Error(message);
  }
  return data as T;
}

// These failures are nearly always one of a few fixable things. Say which one
// and what to do about it, in words that mean something, instead of surfacing
// a bare transport error.
export function marketDataHint(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/Failed to send a request|Failed to fetch|NetworkError|non-2xx|404/i.test(m)) {
    return (
      "Couldn't reach the server that fetches prices. Your plans, positions, " +
      "levels, the screener and CSV import all keep working — only fresh prices " +
      "are affected."
    );
  }
  if (/Instrument not found/i.test(m)) {
    return `${m}\n\nPress “Sync instruments” once in Settings, then try again.`;
  }
  // Kite-specific: never a dead end now that the free source is the default.
  if (/credentials|not set|token|api_key|403|Invalid|expired/i.test(m)) {
    return (
      `${m}\n\nYour Zerodha login has lapsed — they expire every trading day. ` +
      `Either reconnect in Settings, or switch “Where prices come from” to ` +
      `Automatic, which needs no login at all.`
    );
  }
  return m;
}
