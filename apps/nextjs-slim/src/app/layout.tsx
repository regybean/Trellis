import './styles.css';

import type { Metadata, Viewport } from 'next';

import { ChatTRPCReactProvider } from '@acme/chat';
import { IngestTRPCReactProvider } from '@acme/ingest';
// Toast container is rendered client-side to safely access localStorage
import {
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
  title: 'Acme — RAG Press (slim)',
  description:
    'Upload documents and chat with them using retrieval-augmented generation.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f2ea' },
    { media: '(prefers-color-scheme: dark)', color: '#1c151b' },
  ],
};

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
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
                    {/* App-owned brutalist top bar: heavy ink underline, mono
                        kicker, riso-pink issue stamp. Shell/chrome is
                        app-owned (ADR 0011). */}
                    <header className="bg-background border-border sticky top-0 z-30 flex items-center justify-between border-b-2 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <SidebarTrigger className="border-border rounded-none border-2 shadow-[2px_2px_0_0_var(--border)]" />
                        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.28em] uppercase">
                          Retrieval · Augmented · Generation
                        </span>
                      </div>
                      <span className="bg-primary text-primary-foreground hidden px-2 py-1 font-mono text-[10px] tracking-[0.22em] uppercase sm:inline-block">
                        Slim Edition
                      </span>
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
