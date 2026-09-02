/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router';

import { BillingConfigProvider, BillingTRPCReactProvider } from '@acme/billing';
import {
  env as billingEnvValues,
  toBillingClientConfig,
} from '@acme/billing/env';
import { NotificationsProvider } from '@acme/notifications';
import { NextThemeProvider, ToastThemeClient, TooltipProvider } from '@acme/ui';

import { BetterAuthStatusProvider } from '../components/better-auth-status';
import { ConsoleShell } from '../components/console-shell';
import { PersistedFeatureProviders } from '../components/persisted-feature-providers';
import { getAuthState } from '../lib/auth';
import { getLocalstripeMode } from '../lib/stripe';
import appCss from '../styles.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    // Server-resolved so the chat/feedback/ingest persisters have their scope on the
    // first render (see PersistedFeatureProviders). Signed out ⇒ userId null ⇒
    // network-only. localstripeMode is server-derived from the Stripe connection
    // (ADR 0033) and threaded to the client through the BillingConfigProvider seam
    // below.
    beforeLoad: async () => {
      const [{ userId, user }, localstripeMode] = await Promise.all([
        getAuthState(),
        getLocalstripeMode(),
      ]);
      return { userId, user, localstripeMode };
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
 * Provider nesting mirrors the Next.js app's root layout (theme → auth status →
 * Billing/Chat/Ingest tRPC → tooltip), with the theme locked dark to match the
 * developer-console shell. The feature providers are reused as-is.
 *
 * There is **no auth provider**, which is the visible shape of ADR 0034: Better
 * Auth's client is a plain module (`lib/auth-client.ts`) that any component
 * imports directly, so nothing has to wrap the tree. The signed-in
 * principal reaches the shell as a prop off this route's server-resolved
 * context instead of through a context provider — which also means it is present
 * on the first paint rather than after a client-side session fetch.
 *
 * `BetterAuthStatusProvider` is not that: it is the app's half of the *feature*
 * auth seam (`@acme/hooks`), publishing the neutral `AuthStatus` that billing
 * gates its viewer-scoped queries on. It sits outside the billing providers that
 * consume it, and is seeded from the same server-resolved `userId` the shell
 * gets.
 */
function RootDocument({ children }: { children: ReactNode }) {
  const { userId, user, localstripeMode } = Route.useRouteContext();

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
          <BetterAuthStatusProvider initialUserId={userId}>
            <BillingConfigProvider
              config={toBillingClientConfig(billingEnvValues)}
              localstripeMode={localstripeMode}
            >
              <BillingTRPCReactProvider>
                <PersistedFeatureProviders scopeKey={userId ?? undefined}>
                  <NotificationsProvider>
                    <TooltipProvider>
                      <ConsoleShell user={user}>{children}</ConsoleShell>
                      <ToastThemeClient />
                    </TooltipProvider>
                  </NotificationsProvider>
                </PersistedFeatureProviders>
              </BillingTRPCReactProvider>
            </BillingConfigProvider>
          </BetterAuthStatusProvider>
        </NextThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
