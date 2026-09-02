import './styles.css';

import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';

import { BillingConfigProvider, BillingTRPCReactProvider } from '@acme/billing';
import {
  env as billingEnvValues,
  toBillingClientConfig,
} from '@acme/billing/env';
// Server-derived from the Stripe connection (billing env, ADR 0033); threaded to
// the client through the BillingConfigProvider seam so the client never proxies
// billing mode through NODE_ENV.
import { localstripeMode } from '@acme/billing/server';
import { NotificationsProvider } from '@acme/notifications';
// Toast container is rendered client-side to safely access localStorage
import { NextThemeProvider, ToastThemeClient, TooltipProvider } from '@acme/ui';

import { BetterAuthStatusProvider } from '../components/pages/layout/better-auth-status';
import { EditorialShell } from '../components/pages/layout/editorial-shell';
import { PersistedFeatureProviders } from '../components/pages/layout/persisted-feature-providers';
import { env } from '../env';
import { auth } from '../server/auth';

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
  // Server-resolved so the chat/feedback/ingest persisters have their scope on the first
  // render (see PersistedFeatureProviders). Signed out ⇒ undefined ⇒ network-only.
  // This is a real database read of the session row, so it is also what seeds the
  // client seam below — the browser client would otherwise report "loading" on
  // the first paint even for a signed-in visitor.
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id ?? null;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground h-screen overflow-hidden font-sans antialiased">
        <BetterAuthStatusProvider initialUserId={userId}>
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
                  <NotificationsProvider>
                    <TooltipProvider>
                      <EditorialShell>
                        <ToastThemeClient />
                        {props.children}
                      </EditorialShell>
                    </TooltipProvider>
                  </NotificationsProvider>
                </PersistedFeatureProviders>
              </BillingTRPCReactProvider>
            </BillingConfigProvider>
          </NextThemeProvider>
        </BetterAuthStatusProvider>
      </body>
    </html>
  );
}
