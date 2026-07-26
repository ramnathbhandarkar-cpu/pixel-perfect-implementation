import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/plans")({
  head: () => ({
    meta: [
      { title: "Plans · Swing Trade" },
      { name: "description", content: "Watch plans with written invalidation lines." },
    ],
  }),
  component: () => (
    <>
      <PageHeader title="Plans" subtitle="A plan must exist before a position exists" />
      <PageBody>
        <div className="surface p-6 text-center">
          <div className="text-xs text-faint uppercase tracking-widest">Phase 4</div>
          <p className="text-sm text-muted-fg mt-2">
            Watch Plans arrive in Phase 4 alongside the discipline core.
          </p>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  ),
});
