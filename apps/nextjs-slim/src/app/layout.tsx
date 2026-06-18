import './styles.css';

import type { Metadata, Viewport } from 'next';
import { Montserrat } from 'next/font/google';

import { ChatTRPCReactProvider } from '@acme/chat';
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
      : 'http://localhost:3002',
  ),
  title: 'Acme - RAG Assistant (slim)',
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
        <NextThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ChatTRPCReactProvider>
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
          </ChatTRPCReactProvider>
        </NextThemeProvider>
      </body>
    </html>
  );
}
