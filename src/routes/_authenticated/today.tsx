import { createFileRoute } from "@tanstack/react-router";
import {
  PageHeader,
  PageBody,
  DisclaimerFooter,
} from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/today")({
  head: () => ({
    meta: [
      { title: "Today · Swing Trade" },
      {
        name: "description",
        content:
          "Open positions, breached invalidation lines, today's screener result.",
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
      <PageHeader
        title="Today"
        subtitle={`IST ${ist} · NSE 09:15–15:30`}
      />
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
          <EmptyCard
            title="Today's screener"
            body="Screener not yet run. Data ingestion arrives in Phase 2."
          />
          <EmptyCard
            title="Unread alerts"
            body="No alerts yet."
          />
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="surface p-4">
      <div className="text-[11px] text-faint uppercase tracking-widest">
        {title}
      </div>
      <p className="text-sm text-muted-fg mt-2 leading-relaxed">{body}</p>
    </div>
  );
}
