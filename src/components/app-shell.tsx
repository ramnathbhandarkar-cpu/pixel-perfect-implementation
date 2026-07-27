import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { flushOutbox, outboxCount } from "@/lib/offline";
import {
  Home,
  LineChart,
  ScanSearch,
  ClipboardList,
  BookOpen,
  Bell,
  Settings,
  ListChecks,
  LogOut,
  MoreHorizontal,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type IconType = React.ComponentType<{ size?: number; className?: string }>;

export interface NavItem {
  to: string;
  label: string;
  icon: IconType;
  /** One line of plain language explaining what the section is for. */
  blurb?: string;
}

// Four tabs. That is the whole navigation.
//
// This used to be ten sections, which meant deciding where to go before
// deciding what to do. Today / Plans / Positions / Scorecard all folded into
// Home and Trades; everything that is configuration rather than a daily
// action moved behind More.
const PRIMARY: NavItem[] = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/charts", label: "Charts", icon: LineChart },
  { to: "/trades", label: "Trades", icon: ClipboardList },
  { to: "/more", label: "More", icon: MoreHorizontal },
];

// Everything behind More. Nothing here duplicates a tab above.
export const MORE_SECTIONS: NavItem[] = [
  {
    to: "/screener",
    label: "Screener",
    icon: ScanSearch,
    blurb: "The overnight measurements, with the numbers behind each one.",
  },
  {
    to: "/stocks",
    label: "Screener universe",
    icon: ListChecks,
    blurb: "Which stocks get measured overnight.",
  },
  {
    to: "/journal",
    label: "Journal",
    icon: BookOpen,
    blurb: "What you were thinking, in your own words.",
  },
  {
    to: "/alerts",
    label: "Alerts",
    icon: Bell,
    blurb: "Your inbox and the rules that fill it.",
  },
  {
    to: "/settings",
    label: "Settings",
    icon: Settings,
    blurb: "Data source, notifications, exports, and whether prices are fresh.",
  },
];

function isActive(path: string, to: string): boolean {
  return path === to || path.startsWith(to + "/");
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar — same four, plus the More sections spelled out so a
          big screen doesn't force an extra click. */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-surface">
        <div className="px-4 py-4 border-b border-border">
          <div className="text-xs text-faint tracking-widest uppercase">Swing Trade</div>
          <div className="text-sm text-muted-fg mt-0.5">NSE · IST</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {PRIMARY.filter((n) => n.to !== "/more").map((n) => (
            <SidebarLink key={n.to} item={n} active={isActive(path, n.to)} />
          ))}
          <div className="px-4 pt-4 pb-1 text-[10px] text-faint uppercase tracking-widest">
            More
          </div>
          {MORE_SECTIONS.map((n) => (
            <SidebarLink key={n.to} item={n} active={isActive(path, n.to)} />
          ))}
        </nav>
        <OfflineStatus />
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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-surface flex items-stretch z-40 pb-[env(safe-area-inset-bottom)]">
        {PRIMARY.map((n) => {
          const active =
            n.to === "/more"
              ? isActive(path, "/more") || MORE_SECTIONS.some((m) => isActive(path, m.to))
              : isActive(path, n.to);
          const Icon = n.icon;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={
                "flex-1 h-14 flex flex-col items-center justify-center gap-0.5 text-[10px] " +
                (active ? "text-foreground" : "text-muted-fg")
              }
            >
              <Icon size={18} />
              <span>{n.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={
        "flex items-center gap-2.5 px-4 py-2 text-[13px] transition-colors " +
        (active
          ? "text-foreground bg-surface-raised border-l-2 border-accent-info"
          : "text-muted-fg hover:text-foreground hover:bg-surface-raised border-l-2 border-transparent")
      }
    >
      <Icon size={15} />
      <span>{item.label}</span>
    </Link>
  );
}

// Offline / queued-writes indicator. Flushes the outbox when the
// connection returns and on a slow heartbeat.
function OfflineStatus() {
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    const refresh = () => {
      setOnline(navigator.onLine);
      setQueued(outboxCount());
    };
    const onOnline = () => {
      setOnline(true);
      void flushOutbox().then(() => setQueued(outboxCount()));
    };
    refresh();
    if (navigator.onLine && outboxCount() > 0) {
      void flushOutbox().then(() => setQueued(outboxCount()));
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", refresh);
    const t = setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", refresh);
      clearInterval(t);
    };
  }, []);

  if (online && queued === 0) return null;
  return (
    <div className="px-4 py-2 text-[11px] border-t border-border font-mono text-warning">
      {online ? `syncing ${queued} queued change${queued === 1 ? "" : "s"}…` : "offline"}
      {!online && queued > 0 && ` · ${queued} queued`}
    </div>
  );
}

// The alerts inbox lost its tab, so it lives here — visible from every
// screen, silent until there is something unread.
function AlertBell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    const { count, error } = await supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    if (!error) setUnread(count ?? 0);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh, path]);

  return (
    <Link
      to="/alerts"
      aria-label={unread > 0 ? `Alerts, ${unread} unread` : "Alerts"}
      className="relative p-2 -m-1 text-muted-fg hover:text-foreground"
    >
      <Bell size={17} />
      {unread > 0 && (
        <span className="absolute top-0 right-0 min-w-[15px] h-[15px] px-1 rounded-full bg-bearish text-white text-[9px] font-mono font-semibold leading-[15px] text-center">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
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
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <AlertBell />
      </div>
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
