import { createFileRoute, redirect } from "@tanstack/react-router";

// Auth removed for personal single-user use — redirect to app.
export const Route = createFileRoute("/auth")({
  beforeLoad: () => {
    throw redirect({ to: "/today" });
  },
});
