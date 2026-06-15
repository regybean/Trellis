import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { FileText, MessageSquare, SquareTerminal, Tag } from 'lucide-react';

import { SignedIn, SignedOut, SignInButton, UserButton } from '@acme/auth';
import { Button } from '@acme/ui';

import { StatusBar } from './status-bar';

interface NavItem {
  title: string;
  to: string;
  icon: LucideIcon;
}

// Same destinations as the Next.js sidebar — deliberately re-arranged into a
// dense icon rail to prove the shell can diverge while the routes/features match.
const navItems: NavItem[] = [
  { title: 'Chat', to: '/chat-assistant', icon: MessageSquare },
  { title: 'Documents', to: '/admin', icon: FileText },
  { title: 'Pricing', to: '/pricing', icon: Tag },
];

/**
 * App-owned layout chrome: a fixed left rail + top bar in a dark, dense,
 * monospace "developer console" style. This is the divergent shell — it imports
 * no `@acme/sidebar` composition (that one is Next-coupled); the feature
 * components rendered inside `children` are untouched.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <aside className="border-border bg-sidebar flex w-52 shrink-0 flex-col border-r">
        <Link
          to="/"
          className="border-border text-foreground flex h-12 items-center gap-2 border-b px-4 font-mono text-sm font-semibold"
        >
          <SquareTerminal className="text-primary h-5 w-5" />
          acme<span className="text-muted-foreground">/rag</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex items-center gap-2.5 rounded-sm px-3 py-2 font-mono text-[13px] transition-colors"
              activeProps={{
                className:
                  'bg-accent text-accent-foreground border-primary/40 border',
              }}
            >
              <item.icon className="h-4 w-4" />
              {item.title}
            </Link>
          ))}
        </nav>

        <div className="border-border border-t p-3">
          <SignedIn>
            <UserButton />
          </SignedIn>
          <SignedOut>
            <SignInButton mode="modal">
              <Button size="sm" className="w-full font-mono text-xs">
                sign in
              </Button>
            </SignInButton>
          </SignedOut>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-background/80 flex h-12 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          <span className="text-muted-foreground font-mono text-xs">
            ~/acme-rag
          </span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        <StatusBar />
      </div>
    </div>
  );
}
