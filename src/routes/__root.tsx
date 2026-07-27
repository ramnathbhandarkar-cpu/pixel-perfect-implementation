import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  Link,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-6xl font-semibold text-foreground">404</h1>
        <p className="mt-3 text-sm text-muted-foreground">This screen doesn't exist.</p>
        <Link to="/" className="mt-6 inline-block btn-primary hover:btn-primary-hover">
          Go home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message || "Unexpected error."}</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 btn-primary hover:btn-primary-hover"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no",
      },
      { name: "theme-color", content: "#0f0f11" },
      { title: "Swing Trade — discipline for Indian equities" },
      {
        name: "description",
        content:
          "A trading discipline system for NSE swing traders. Measures and describes; never recommends.",
      },
      {
        property: "og:title",
        content: "Swing Trade — discipline for Indian equities",
      },
      {
        property: "og:description",
        content:
          "A trading discipline system for NSE swing traders. Measures and describes; never recommends.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Swing Trade — discipline for Indian equities" },
      {
        name: "twitter:description",
        content:
          "A trading discipline system for NSE swing traders. Measures and describes; never recommends.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/3d8a323e-c087-4cc0-a75a-07c46fa98f72/id-preview-9f593136--7dead643-3050-49c2-9de6-11cd279b65cd.lovable.app-1785047902319.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/3d8a323e-c087-4cc0-a75a-07c46fa98f72/id-preview-9f593136--7dead643-3050-49c2-9de6-11cd279b65cd.lovable.app-1785047902319.png",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/favicon.ico" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    // Register service worker for PWA
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
