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

import { BillingConfigProvider, BillingTRPCReactProvider } from '@acme/billing';
import { toBillingClientConfig } from '@acme/billing/config';
import { IngestTRPCReactProvider } from '@acme/ingest';
import { NotificationsProvider } from '@acme/notifications';
import { NextThemeProvider, ToastThemeClient, TooltipProvider } from '@acme/ui';

import { ConsoleShell } from '../components/console-shell';
import { PersistedFeatureProviders } from '../components/persisted-feature-providers';
import { config } from '../config';
import { getAuthState } from '../lib/auth';
import { getLocalstripeMode } from '../lib/stripe';
import appCss from '../styles.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    // Server-resolved so the chat/feedback persisters have their scope on the
    // first render (see PersistedFeatureProviders). Signed out ⇒ userId null ⇒
    // network-only. localstripeMode is server-derived from the connection config
    // (ADR 0026 follow-up) and threaded to the client through the
    // BillingConfigProvider seam below.
    beforeLoad: async () => {
      const [{ userId }, localstripeMode] = await Promise.all([
        getAuthState(),
        getLocalstripeMode(),
      ]);
      return { userId, localstripeMode };
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
  const { userId, localstripeMode } = Route.useRouteContext();

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <ClerkProvider
          publishableKey={config.CLERK_PUBLISHABLE_KEY}
          signInUrl={config.CLERK_SIGN_IN_URL}
          signUpUrl={config.CLERK_SIGN_UP_URL}
          signInForceRedirectUrl={config.CLERK_SIGN_IN_FORCE_REDIRECT_URL}
          signUpForceRedirectUrl={config.CLERK_SIGN_UP_FORCE_REDIRECT_URL}
          appearance={{ baseTheme: dark }}
        >
          <NextThemeProvider
            attribute="class"
            forcedTheme="dark"
            disableTransitionOnChange
          >
            <BillingConfigProvider
              config={toBillingClientConfig(config)}
              localstripeMode={localstripeMode}
            >
              <BillingTRPCReactProvider>
                <PersistedFeatureProviders scopeKey={userId ?? undefined}>
                  <IngestTRPCReactProvider>
                    <NotificationsProvider>
                      <TooltipProvider>
                        <ConsoleShell>{children}</ConsoleShell>
                        <ToastThemeClient />
                      </TooltipProvider>
                    </NotificationsProvider>
                  </IngestTRPCReactProvider>
                </PersistedFeatureProviders>
              </BillingTRPCReactProvider>
            </BillingConfigProvider>
          </NextThemeProvider>
        </ClerkProvider>
        <Scripts />
      </body>
    </html>
  );
}
