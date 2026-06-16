import './styles.css';

import type { Metadata, Viewport } from 'next';
import { Montserrat } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';

import { BillingTRPCReactProvider } from '@acme/billing';
import { ChatTRPCReactProvider } from '@acme/chat';
import { FeedbackTRPCReactProvider } from '@acme/feedback';
import { IngestTRPCReactProvider } from '@acme/ingest';
// Toast container is rendered client-side to safely access localStorage
import {
  cn,
  NextThemeProvider,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  ToastThemeClient,
  TooltipProvider,
} from '@acme/ui';

import { Sidebar } from '../components/pages/layout/sidebar';
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

const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
});

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          'bg-background text-foreground min-h-screen font-sans antialiased',
          montserrat.variable,
        )}
      >
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
                      <SidebarProvider>
                        <Sidebar />
                        <SidebarInset>
                          <header className="bg-background sticky top-0 p-4">
                            <SidebarTrigger />
                          </header>
                          <main>
                            <ToastThemeClient />
                            {props.children}
                          </main>
                        </SidebarInset>
                      </SidebarProvider>
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
