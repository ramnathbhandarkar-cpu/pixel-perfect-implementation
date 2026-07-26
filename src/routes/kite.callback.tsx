import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { callSwing } from "@/lib/swing-api";

// Kite redirects here after a successful login with ?request_token=...
// The token is exchanged for today's access token server-side (the api_secret
// never reaches the browser) and then we bounce back to Settings.
//
// Not under _authenticated: Kite controls the redirect and we want to show a
// useful message even if the session needs re-establishing.
export const Route = createFileRoute("/kite/callback")({
  ssr: false,
  component: KiteCallback,
});

function KiteCallback() {
  const navigate = useNavigate();
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("Exchanging your Kite login…");
  const ran = useRef(false);

  useEffect(() => {
    // A request_token is single-use; never exchange it twice.
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const requestToken = params.get("request_token");
    const kiteStatus = params.get("status");

    if (!requestToken) {
      setState("error");
      setMessage(
        kiteStatus === "cancelled"
          ? "Login was cancelled on Kite's side. Nothing was changed."
          : "Kite did not send a request_token. Start the login again from Settings.",
      );
      return;
    }

    (async () => {
      try {
        const r = await callSwing<{ kite_user_id?: string | null }>("kite_exchange", {
          request_token: requestToken,
        });
        setState("done");
        setMessage(
          `Connected${r.kite_user_id ? ` as ${r.kite_user_id}` : ""}. Today's access token is stored server-side.`,
        );
        // Clear the token out of the address bar, then continue.
        window.history.replaceState({}, "", "/kite/callback");
        setTimeout(() => navigate({ to: "/settings", replace: true }), 1400);
      } catch (e) {
        setState("error");
        setMessage(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="surface p-6 w-full max-w-md space-y-3">
        <div className="text-xs text-faint tracking-widest uppercase">Swing Trade</div>
        <h1 className="text-lg font-semibold text-foreground">
          {state === "working"
            ? "Connecting to Kite"
            : state === "done"
              ? "Kite connected"
              : "Kite connection failed"}
        </h1>
        <p
          className={
            "text-sm " +
            (state === "error"
              ? "text-bearish"
              : state === "done"
                ? "text-bullish"
                : "text-muted-fg")
          }
        >
          {message}
        </p>
        {state !== "working" && (
          <Link to="/settings" className="inline-block btn-primary hover:btn-primary-hover text-xs">
            Back to Settings
          </Link>
        )}
      </div>
    </div>
  );
}
