import { createFileRoute, redirect } from "@tanstack/react-router";

// Folded into /home during the four-tab simplification. Kept as a redirect so
// bookmarks, the installed PWA's start_url and old push links still land
// somewhere sensible.
export const Route = createFileRoute("/_authenticated/today")({
  beforeLoad: () => {
    throw redirect({ to: "/home", replace: true });
  },
});
