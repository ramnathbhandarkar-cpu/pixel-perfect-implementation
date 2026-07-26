import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/journal")({
  head: () => ({
    meta: [
      { title: "Journal · Swing Trade" },
      { name: "description", content: "Dated notes linked to positions." },
    ],
  }),
  component: () => (
    <>
      <PageHeader title="Journal" subtitle="Dated notes, linked to trades" />
      <PageBody>
        <div className="surface p-6 text-center">
          <div className="text-xs text-faint uppercase tracking-widest">Phase 6</div>
          <p className="text-sm text-muted-fg mt-2">Journal arrives with offline polish in Phase 6.</p>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  ),
});
