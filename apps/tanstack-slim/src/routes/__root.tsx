/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router';

import { ChatTRPCReactProvider } from '@acme/chat';
import { IngestTRPCReactProvider } from '@acme/ingest';
import { NextThemeProvider, ToastThemeClient, TooltipProvider } from '@acme/ui';

import { ConsoleShell } from '../components/console-shell';
import appCss from '../styles.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: 'utf8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title: 'Acme — RAG Console (slim)' },
      ],
      links: [{ rel: 'stylesheet', href: appCss }],
    }),
    component: RootComponent,
  },
);

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

/**
 * Provider nesting mirrors the Next.js slim app's root layout (theme →
 * Chat/Ingest tRPC → tooltip). No Clerk, no billing/feedback providers — the
 * slim app injects a constant principal at the tRPC route seam instead. The
 * theme is locked dark to match the developer-console shell.
 *
 * Chat persistence is scoped to a constant 'anon' principal (ADR 0025): slim has
 * no auth, so no per-user scope and no logout to clear the cache. The load pain
 * is data-load, not auth, so the instant-load win is identical to the full app;
 * `buster` still discards on version change.
 */
function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <NextThemeProvider
          attribute="class"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          <ChatTRPCReactProvider scopeKey="anon">
            <IngestTRPCReactProvider>
              <TooltipProvider>
                <ConsoleShell>{children}</ConsoleShell>
                <ToastThemeClient />
              </TooltipProvider>
            </IngestTRPCReactProvider>
          </ChatTRPCReactProvider>
        </NextThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
