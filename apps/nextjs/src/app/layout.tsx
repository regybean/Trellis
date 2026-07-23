import './styles.css';

import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';

import { BillingTRPCReactProvider } from '@acme/billing';
import { ChatTRPCReactProvider } from '@acme/chat';
import { FeedbackTRPCReactProvider } from '@acme/feedback';
import { IngestTRPCReactProvider } from '@acme/ingest';
// Toast container is rendered client-side to safely access localStorage
import { NextThemeProvider, ToastThemeClient, TooltipProvider } from '@acme/ui';

import { EditorialShell } from '../components/pages/layout/editorial-shell';
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

export default function RootLayout(props: { children: React.ReactNode }) {
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
              <ChatTRPCReactProvider>
                <FeedbackTRPCReactProvider>
                  <IngestTRPCReactProvider>
                    <TooltipProvider>
                      <EditorialShell>
                        <ToastThemeClient />
                        {props.children}
                      </EditorialShell>
                    </TooltipProvider>
                  </IngestTRPCReactProvider>
                </FeedbackTRPCReactProvider>
              </ChatTRPCReactProvider>
            </BillingTRPCReactProvider>
          </NextThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
