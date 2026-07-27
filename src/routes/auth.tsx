import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Single-account app: sign-in only. No signup, no reset flow — the one
// account is created by the owner in the Supabase dashboard, and a database
// trigger blocks any further accounts.
export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [{ title: "Sign in · Swing Trade" }],
  }),
  ssr: false,
  component: AuthScreen,
});

function AuthScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/home", replace: true });
    });
  }, [navigate]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    navigate({ to: "/home", replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form onSubmit={signIn} className="surface p-6 w-full max-w-sm space-y-4">
        <div>
          <div className="text-xs text-faint tracking-widest uppercase">Swing Trade</div>
          <h1 className="text-lg font-semibold text-foreground mt-1">Sign in</h1>
        </div>
        <label className="block">
          <span className="text-xs text-muted-fg">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            className="mt-1 w-full bg-surface-raised border border-border rounded-md px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-fg">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="mt-1 w-full bg-surface-raised border border-border rounded-md px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="btn-primary hover:btn-primary-hover w-full disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {err && <p className="text-xs text-bearish">{err}</p>}
      </form>
    </div>
  );
}
