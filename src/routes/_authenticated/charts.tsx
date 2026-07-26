import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/charts")({
  head: () => ({
    meta: [
      { title: "Charts · Swing Trade" },
      { name: "description", content: "Candlestick charts with indicators and level overlays." },
    ],
  }),
  component: () => (
    <>
      <PageHeader title="Charts" subtitle="Candlesticks, indicators, level overlays" />
      <PageBody>
        <Placeholder phase="Phase 2" />
      </PageBody>
      <DisclaimerFooter />
    </>
  ),
});

function Placeholder({ phase }: { phase: string }) {
  return (
    <div className="surface p-6 text-center">
      <div className="text-xs text-faint uppercase tracking-widest">{phase}</div>
      <p className="text-sm text-muted-fg mt-2">
        This screen ships in {phase}. The foundation is ready.
      </p>
    </div>
  );
}
