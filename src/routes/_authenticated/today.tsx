import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/today")({
  head: () => ({
    meta: [
      { title: "Today · Swing Trade" },
      {
        name: "description",
        content: "Open positions, breached invalidation lines, today's screener result.",
      },
    ],
  }),
  component: TodayScreen,
});

function TodayScreen() {
  const now = new Date();
  const ist = now.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <PageHeader title="Today" subtitle={`IST ${ist} · NSE 09:15–15:30`} />
      <PageBody>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <EmptyCard
            title="Breached invalidation lines"
            body="No open positions have closed beyond their invalidation line."
          />
          <EmptyCard
            title="Open positions"
            body="You have no open positions. Log one from the Positions screen — a Watch Plan is required first."
          />
          <ScreenerCard />
          <EmptyCard title="Unread alerts" body="No alerts yet." />
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}

function ScreenerCard() {
  const [run, setRun] = useState<{
    run_date: string;
    qualifying: unknown[];
    scanned: number | null;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("screener_runs")
        .select("run_date, qualifying, scanned")
        .order("run_date", { ascending: false })
        .limit(1);
      setRun((data?.[0] as typeof run) ?? null);
      setLoaded(true);
    })();
  }, []);

  const count = run && Array.isArray(run.qualifying) ? run.qualifying.length : 0;

  return (
    <div className="surface p-4">
      <div className="text-[11px] text-faint uppercase tracking-widest">Today's screener</div>
      {!loaded ? (
        <p className="text-sm text-muted-fg mt-2">Loading…</p>
      ) : run == null ? (
        <p className="text-sm text-muted-fg mt-2 leading-relaxed">
          No screener run saved yet. Open the{" "}
          <Link to="/screener" className="text-accent-info hover:underline">
            Screener
          </Link>{" "}
          to compute levels and run it.
        </p>
      ) : (
        <p className="text-sm text-muted-fg mt-2 leading-relaxed">
          {count === 0 ? (
            <>Last run {run.run_date}: no qualifying setups — a normal result, not a failure. </>
          ) : (
            <>
              Last run {run.run_date}: <span className="text-foreground">{count} qualifying</span>{" "}
              of {run.scanned ?? "—"} scanned.{" "}
            </>
          )}
          <Link to="/screener" className="text-accent-info hover:underline">
            View
          </Link>
        </p>
      )}
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="surface p-4">
      <div className="text-[11px] text-faint uppercase tracking-widest">{title}</div>
      <p className="text-sm text-muted-fg mt-2 leading-relaxed">{body}</p>
    </div>
  );
}
