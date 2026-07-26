// Pure helpers for the Kite Connect login handshake. Kept in src/lib so they
// are unit-tested here; the edge function holds the same logic (it is the only
// place the api_secret exists).

export const KITE_LOGIN_BASE = "https://kite.zerodha.com/connect/login";

export function kiteLoginUrl(apiKey: string): string {
  if (!apiKey.trim()) throw new Error("api_key is required");
  return `${KITE_LOGIN_BASE}?v=3&api_key=${encodeURIComponent(apiKey.trim())}`;
}

/**
 * Kite returns the request_token on the redirect. People paste either the bare
 * token or the entire address bar, so accept both.
 */
export function extractRequestToken(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) throw new Error("request_token is required");
  const m = s.match(/[?&]request_token=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (/^[A-Za-z0-9_-]+$/.test(s)) return s;
  throw new Error("Could not find a request_token in that text");
}

/** checksum = SHA256(api_key + request_token + api_secret), lowercase hex. */
export async function kiteChecksum(
  apiKey: string,
  requestToken: string,
  apiSecret: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(apiKey + requestToken + apiSecret);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
