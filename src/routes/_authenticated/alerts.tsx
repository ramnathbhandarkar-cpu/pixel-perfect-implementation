import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts · Swing Trade" },
      { name: "description", content: "Alert inbox and rule configuration." },
    ],
  }),
  component: () => (
    <>
      <PageHeader title="Alerts" subtitle="Inbox and rules" />
      <PageBody>
        <div className="surface p-6 text-center">
          <div className="text-xs text-faint uppercase tracking-widest">Phase 5</div>
          <p className="text-sm text-muted-fg mt-2">Web Push alerts and rules land in Phase 5.</p>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  ),
});
