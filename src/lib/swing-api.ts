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

// Kite failures are nearly always one of a few fixable things. Say which one,
// and what to do about it, instead of surfacing a bare transport error.
export function marketDataHint(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/Failed to send a request|Failed to fetch|NetworkError|non-2xx|404/i.test(m)) {
    return (
      `${m}\n\nThe market-data function is not reachable, which normally means the ` +
      `one-time backend deploy hasn't run yet (GitHub → Actions → “Deploy Supabase ` +
      `backend”). Everything else — plans, positions, the screener, levels and CSV ` +
      `import — works without it.`
    );
  }
  if (/credentials|not set/i.test(m)) {
    return `${m}\n\nSave today's Kite API key and access token in Settings.`;
  }
  if (/Instrument not found/i.test(m)) {
    return `${m}\n\nPress “Sync instruments” once, then retry.`;
  }
  if (/token|api_key|403|Invalid|expired/i.test(m)) {
    return `${m}\n\nKite access tokens expire daily — paste a fresh one in Settings.`;
  }
  return m;
}
