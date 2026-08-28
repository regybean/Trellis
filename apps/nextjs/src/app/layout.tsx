import './styles.css';

import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';

import { clerkWiringEnv } from '@acme/auth/env';
import { BillingConfigProvider, BillingTRPCReactProvider } from '@acme/billing';
import {
  env as billingEnvValues,
  toBillingClientConfig,
} from '@acme/billing/env';
// Server-derived from the Stripe connection (billing env, ADR 0033); threaded to
// the client through the BillingConfigProvider seam so the client never proxies
// billing mode through NODE_ENV.
import { localstripeMode } from '@acme/billing/server';
import { IngestTRPCReactProvider } from '@acme/ingest';
import { NotificationsProvider } from '@acme/notifications';
// Toast container is rendered client-side to safely access localStorage
import { NextThemeProvider, ToastThemeClient, TooltipProvider } from '@acme/ui';

import { EditorialShell } from '../components/pages/layout/editorial-shell';
import { PersistedFeatureProviders } from '../components/pages/layout/persisted-feature-providers';
import { env } from '../env';

// Clerk's browser-safe wiring comes from the owning slice's env, not the app's
// composed `env`: t3-env's access guard is name-based, so an unprefixed key is
// only readable through the call that declares it `shared` (ADR 0033 §6).
const clerk = clerkWiringEnv();

export const metadata: Metadata = {
  metadataBase: new URL(
    env.NODE_ENV === 'production'
      ? 'https://example.com'
      : 'http://localhost:3000',
  ),
  title: 'Acme - RAG Assistant',
  description:
    'Upload documents and chat with them using retrieval-augmented generation.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
};

export default async function RootLayout(props: { children: React.ReactNode }) {
  // Server-resolved so the chat/feedback persisters have their scope on the first
  // render (see PersistedFeatureProviders). Signed out ⇒ undefined ⇒ network-only.
  const { userId } = await auth();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground h-screen overflow-hidden font-sans antialiased">
        <ClerkProvider
          publishableKey={clerk.CLERK_PUBLISHABLE_KEY}
          signInUrl={clerk.CLERK_SIGN_IN_URL}
          signUpUrl={clerk.CLERK_SIGN_UP_URL}
          signInForceRedirectUrl={clerk.CLERK_SIGN_IN_FORCE_REDIRECT_URL}
          signUpForceRedirectUrl={clerk.CLERK_SIGN_UP_FORCE_REDIRECT_URL}
        >
          <NextThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
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
                        <EditorialShell>
                          <ToastThemeClient />
                          {props.children}
                        </EditorialShell>
                      </TooltipProvider>
                    </NotificationsProvider>
                  </IngestTRPCReactProvider>
                </PersistedFeatureProviders>
              </BillingTRPCReactProvider>
            </BillingConfigProvider>
          </NextThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
