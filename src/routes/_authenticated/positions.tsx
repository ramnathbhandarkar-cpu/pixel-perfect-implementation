import { createFileRoute, redirect } from "@tanstack/react-router";

// Folded into /trades during the four-tab simplification. Kept as a redirect so
// bookmarks, the installed PWA's start_url and old push links still land
// somewhere sensible.
export const Route = createFileRoute("/_authenticated/positions")({
  beforeLoad: () => {
    throw redirect({ to: "/trades", replace: true });
  },
});
