import './styles.css';

import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';

import { BillingTRPCReactProvider } from '@acme/billing';
import { IngestTRPCReactProvider } from '@acme/ingest';
// Toast container is rendered client-side to safely access localStorage
import { NextThemeProvider, ToastThemeClient, TooltipProvider } from '@acme/ui';

import { EditorialShell } from '../components/pages/layout/editorial-shell';
import { PersistedFeatureProviders } from '../components/pages/layout/persisted-feature-providers';
import { env } from '../env';

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
        <ClerkProvider publishableKey={env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>
          <NextThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <BillingTRPCReactProvider>
              <PersistedFeatureProviders scopeKey={userId ?? undefined}>
                <IngestTRPCReactProvider>
                  <TooltipProvider>
                    <EditorialShell>
                      <ToastThemeClient />
                      {props.children}
                    </EditorialShell>
                  </TooltipProvider>
                </IngestTRPCReactProvider>
              </PersistedFeatureProviders>
            </BillingTRPCReactProvider>
          </NextThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
