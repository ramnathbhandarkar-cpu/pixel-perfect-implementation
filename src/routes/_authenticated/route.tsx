import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";

// Personal single-user app: no auth gate.
export const Route = createFileRoute("/_authenticated")({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
