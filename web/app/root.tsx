import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import { AppShell } from "~/components/app-shell";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/toast";
import { SessionProvider } from "~/lib/session";
import "~/lib/i18n";
import "./app.css";

// Applies the `.dark` class before first paint so the page never flashes.
// The light palette is the default; "dark" or "system" can be chosen from the header (stored in localStorage).
const themeScript = `(function(){try{var k='broom-theme';var m=window.matchMedia('(prefers-color-scheme: dark)');var a=function(){var t=localStorage.getItem(k)||'light';document.documentElement.classList.toggle('dark',t==='dark'||(t==='system'&&m.matches))};a();m.addEventListener('change',a);window.addEventListener('storage',function(e){if(e.key===k)a()})}catch(e){}})();`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>AWS Broom</title>
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#0b0b0b" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-background text-foreground">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function HydrateFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      AWS Broom
    </div>
  );
}

export default function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 } },
      }),
  );
  const { i18n } = useTranslation();
  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <AppShell>
          <Outlet />
        </AppShell>
        <Toaster />
      </SessionProvider>
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const { t } = useTranslation();
  let message = t("error.title");
  let details = t("error.body");
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? t("error.notFoundTitle") : t("error.title");
    details = error.status === 404 ? t("error.notFoundBody") : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto max-w-3xl p-6 pt-16">
      <h1 className="text-2xl font-semibold">{message}</h1>
      <p className="mt-2 text-muted-foreground">{details}</p>
      {stack && (
        <pre className="mt-4 w-full overflow-x-auto rounded-lg bg-muted p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
      <Button className="mt-6" render={<Link to="/" />}>
        {t("error.home")}
      </Button>
    </main>
  );
}
