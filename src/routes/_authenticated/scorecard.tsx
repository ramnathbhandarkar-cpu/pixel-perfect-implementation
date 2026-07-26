import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/scorecard")({
  head: () => ({
    meta: [
      { title: "Scorecard · Swing Trade" },
      { name: "description", content: "Discipline metrics including cost of delay." },
    ],
  }),
  component: () => (
    <>
      <PageHeader title="Scorecard" subtitle="Discipline metrics · cost of delay" />
      <PageBody>
        <div className="surface p-6 text-center">
          <div className="text-xs text-faint uppercase tracking-widest">Phase 4</div>
          <p className="text-sm text-muted-fg mt-2">The Scorecard needs positions to measure.</p>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  ),
});
