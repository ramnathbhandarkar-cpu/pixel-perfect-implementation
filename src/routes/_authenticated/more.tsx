import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, LogOut } from "lucide-react";
import { PageHeader, PageBody, DisclaimerFooter, MORE_SECTIONS } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

// The fourth tab. Everything here is something you set up once, or look at
// when you want detail — never something you have to visit to trade.
export const Route = createFileRoute("/_authenticated/more")({
  head: () => ({
    meta: [
      { title: "More · Swing Trade" },
      { name: "description", content: "Settings, journal, alerts and exports." },
    ],
  }),
  component: MoreScreen,
});

function MoreScreen() {
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <>
      <PageHeader title="More" subtitle="Set up once, then forget about it" />
      <PageBody>
        <div className="max-w-xl">
          <nav className="surface divide-y divide-border overflow-hidden">
            {MORE_SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <Link
                  key={s.to}
                  to={s.to}
                  className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-raised transition-colors"
                >
                  <Icon size={17} className="text-muted-fg shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground">{s.label}</span>
                    {s.blurb && (
                      <span className="block text-xs text-muted-fg mt-0.5 leading-relaxed">
                        {s.blurb}
                      </span>
                    )}
                  </span>
                  <ChevronRight size={15} className="text-faint shrink-0" />
                </Link>
              );
            })}
          </nav>

          <button
            onClick={signOut}
            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 text-sm text-muted-fg hover:text-foreground surface"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}
