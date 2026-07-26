import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  Activity,
  LineChart,
  ScanSearch,
  ClipboardList,
  Wallet,
  Trophy,
  BookOpen,
  Bell,
  Settings,
  ListChecks,
  LogOut,
  MoreHorizontal,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type NavItem = {
  to: string;
  label: string;
  short: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  mobile?: boolean;
};

const NAV: NavItem[] = [
  { to: "/today", label: "Today", short: "Today", icon: Activity, mobile: true },
  { to: "/charts", label: "Charts", short: "Charts", icon: LineChart, mobile: true },
  { to: "/screener", label: "Screener", short: "Screen", icon: ScanSearch },
  { to: "/plans", label: "Plans", short: "Plans", icon: ClipboardList, mobile: true },
  { to: "/positions", label: "Positions", short: "Positions", icon: Wallet, mobile: true },
  { to: "/scorecard", label: "Scorecard", short: "Score", icon: Trophy },
  { to: "/journal", label: "Journal", short: "Journal", icon: BookOpen },
  { to: "/alerts", label: "Alerts", short: "Alerts", icon: Bell },
  { to: "/stocks", label: "Stocks", short: "Stocks", icon: ListChecks },
  { to: "/settings", label: "Settings", short: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-surface">
        <div className="px-4 py-4 border-b border-border">
          <div className="text-xs text-faint tracking-widest uppercase">Swing Trade</div>
          <div className="text-sm text-muted-fg mt-0.5">NSE · IST</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV.map((n) => {
            const active = path === n.to || path.startsWith(n.to + "/");
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={
                  "flex items-center gap-2.5 px-4 py-2 text-[13px] transition-colors " +
                  (active
                    ? "text-foreground bg-surface-raised border-l-2 border-accent-info"
                    : "text-muted-fg hover:text-foreground hover:bg-surface-raised border-l-2 border-transparent")
                }
              >
                <Icon size={15} />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <button
          onClick={signOut}
          className="flex items-center gap-2 px-4 py-3 text-xs text-muted-fg hover:text-foreground border-t border-border"
        >
          <LogOut size={14} /> Sign out
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col pb-16 md:pb-0">{children}</main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-14 border-t border-border bg-surface flex items-stretch z-40">
        {NAV.filter((n) => n.mobile).map((n) => {
          const active = path === n.to || path.startsWith(n.to + "/");
          const Icon = n.icon;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={
                "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] " +
                (active ? "text-foreground" : "text-muted-fg")
              }
            >
              <Icon size={18} />
              <span>{n.short}</span>
            </Link>
          );
        })}
        <Link
          to="/settings"
          className={
            "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] " +
            (path === "/settings" ||
            path === "/screener" ||
            path === "/scorecard" ||
            path === "/journal" ||
            path === "/alerts" ||
            path === "/stocks"
              ? "text-foreground"
              : "text-muted-fg")
          }
        >
          <MoreHorizontal size={18} />
          <span>More</span>
        </Link>
      </nav>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-border px-5 md:px-6 py-4 flex items-start justify-between gap-4 bg-background">
      <div className="min-w-0">
        <h1 className="text-lg md:text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="text-xs text-muted-fg mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="flex-1 p-5 md:p-6">{children}</div>;
}

export function DisclaimerFooter() {
  return (
    <div className="text-[10px] text-faint px-5 md:px-6 py-3 border-t border-border">
      Descriptive measurements only. Not financial advice.
    </div>
  );
}
