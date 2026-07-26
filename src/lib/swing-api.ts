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
