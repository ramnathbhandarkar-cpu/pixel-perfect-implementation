import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/today" });
  },
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate({ to: "/today" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (data.session) {
          navigate({ to: "/today" });
        } else {
          setInfo("Check your email to confirm your account, then sign in.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm surface p-6">
        <div className="text-xs text-faint tracking-widest uppercase mb-2">
          Swing Trade
        </div>
        <h1 className="text-xl font-semibold mb-1">
          {mode === "signin" ? "Sign in" : "Create account"}
        </h1>
        <p className="text-xs text-muted-fg mb-5">
          Single-user app. Your data is private and RLS-scoped.
        </p>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-xs text-muted-fg">Email</span>
            <input
              type="email"
              required
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full bg-surface-raised border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-info"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-fg">Password</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full bg-surface-raised border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-info"
            />
          </label>

          {error && (
            <div className="text-xs text-bearish border border-bearish/40 bg-bearish/10 rounded px-2 py-1.5">
              {error}
            </div>
          )}
          {info && (
            <div className="text-xs text-muted-fg border border-border rounded px-2 py-1.5">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full btn-primary hover:btn-primary-hover disabled:opacity-60"
          >
            {submitting
              ? "Working…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setInfo(null);
            setMode(mode === "signin" ? "signup" : "signin");
          }}
          className="mt-4 w-full text-xs text-muted-fg hover:text-foreground"
        >
          {mode === "signin"
            ? "No account yet? Create one"
            : "Already have an account? Sign in"}
        </button>

        <div className="mt-6 text-[10px] text-faint leading-relaxed">
          Descriptive measurements only. Not financial advice.
        </div>
      </div>
    </div>
  );
}
