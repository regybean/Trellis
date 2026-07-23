/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/tanstack-react-start';
import { dark } from '@clerk/themes';
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router';

import { BillingTRPCReactProvider } from '@acme/billing';
import { IngestTRPCReactProvider } from '@acme/ingest';
import { NextThemeProvider, ToastThemeClient, TooltipProvider } from '@acme/ui';

import { ConsoleShell } from '../components/console-shell';
import { PersistedFeatureProviders } from '../components/persisted-feature-providers';
import { getAuthState } from '../lib/auth';
import appCss from '../styles.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    // Server-resolved so the chat/feedback persisters have their scope on the
    // first render (see PersistedFeatureProviders). Signed out ⇒ userId null ⇒
    // network-only.
    beforeLoad: async () => {
      const { userId } = await getAuthState();
      return { userId };
    },
    head: () => ({
      meta: [
        { charSet: 'utf8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title: 'Acme — RAG Console' },
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
 * Provider nesting mirrors the Next.js app's root layout (Clerk → theme →
 * Billing/Chat/Ingest tRPC → tooltip), with two app-owned divergences: the
 * Clerk provider is the TanStack Start one, and the theme is locked dark to
 * match the developer-console shell. The feature providers are reused as-is.
 */
function RootDocument({ children }: { children: ReactNode }) {
  const { userId } = Route.useRouteContext();

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <ClerkProvider
          publishableKey={import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
          appearance={{ baseTheme: dark }}
        >
          <NextThemeProvider
            attribute="class"
            forcedTheme="dark"
            disableTransitionOnChange
          >
            <BillingTRPCReactProvider>
              <PersistedFeatureProviders scopeKey={userId ?? undefined}>
                <IngestTRPCReactProvider>
                  <TooltipProvider>
                    <ConsoleShell>{children}</ConsoleShell>
                    <ToastThemeClient />
                  </TooltipProvider>
                </IngestTRPCReactProvider>
              </PersistedFeatureProviders>
            </BillingTRPCReactProvider>
          </NextThemeProvider>
        </ClerkProvider>
        <Scripts />
      </body>
    </html>
  );
}
