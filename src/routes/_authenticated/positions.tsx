import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/positions")({
  head: () => ({
    meta: [
      { title: "Positions · Swing Trade" },
      { name: "description", content: "Open and closed positions, each linked to a plan." },
    ],
  }),
  component: () => (
    <>
      <PageHeader title="Positions" subtitle="Every entry requires a linked plan" />
      <PageBody>
        <div className="surface p-6 text-center">
          <div className="text-xs text-faint uppercase tracking-widest">Phase 4</div>
          <p className="text-sm text-muted-fg mt-2">
            Position logging and the invalidation-line watcher arrive in Phase 4.
          </p>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  ),
});
