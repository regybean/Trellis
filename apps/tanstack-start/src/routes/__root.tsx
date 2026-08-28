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

import { clerkWiringEnv } from '@acme/auth/env';
import { BillingConfigProvider, BillingTRPCReactProvider } from '@acme/billing';
import {
  env as billingEnvValues,
  toBillingClientConfig,
} from '@acme/billing/env';
import { IngestTRPCReactProvider } from '@acme/ingest';
import { NotificationsProvider } from '@acme/notifications';
import { NextThemeProvider, ToastThemeClient, TooltipProvider } from '@acme/ui';

import { ConsoleShell } from '../components/console-shell';
import { PersistedFeatureProviders } from '../components/persisted-feature-providers';
import { getAuthState } from '../lib/auth';
import { getLocalstripeMode } from '../lib/stripe';
import appCss from '../styles.css?url';

// Clerk's browser-safe wiring comes from the owning slice's env, not the app's
// composed `env`: t3-env's access guard is name-based, so an unprefixed key is
// only readable through the call that declares it `shared` (ADR 0033 §6). This
// route renders on both sides, which is exactly why the read goes here.
const clerk = clerkWiringEnv();

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    // Server-resolved so the chat/feedback persisters have their scope on the
    // first render (see PersistedFeatureProviders). Signed out ⇒ userId null ⇒
    // network-only. localstripeMode is server-derived from the Stripe connection
    // (ADR 0033) and threaded to the client through the BillingConfigProvider seam
    // below.
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
          publishableKey={clerk.CLERK_PUBLISHABLE_KEY}
          signInUrl={clerk.CLERK_SIGN_IN_URL}
          signUpUrl={clerk.CLERK_SIGN_UP_URL}
          signInForceRedirectUrl={clerk.CLERK_SIGN_IN_FORCE_REDIRECT_URL}
          signUpForceRedirectUrl={clerk.CLERK_SIGN_UP_FORCE_REDIRECT_URL}
          appearance={{ baseTheme: dark }}
        >
          <NextThemeProvider
            attribute="class"
            forcedTheme="dark"
            disableTransitionOnChange
          >
            <BillingConfigProvider
              config={toBillingClientConfig(billingEnvValues)}
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
