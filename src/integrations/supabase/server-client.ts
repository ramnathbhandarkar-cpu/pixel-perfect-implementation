import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the publishable key.
 * RLS is disabled on all tables (personal single-user app), so this
 * has full read/write access.
 *
 * Opaque `sb_publishable_*` keys aren't JWTs — the default Authorization
 * header breaks PostgREST. Send only `apikey`.
 */
export function serverSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL/key not configured");
  const isOpaque = key.startsWith("sb_");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storage: undefined,
    },
    global: isOpaque
      ? {
          fetch: (input, init) => {
            const headers = new Headers(init?.headers);
            if (headers.get("Authorization") === `Bearer ${key}`) {
              headers.delete("Authorization");
            }
            headers.set("apikey", key);
            return fetch(input, { ...init, headers });
          },
        }
      : undefined,
  });
}
