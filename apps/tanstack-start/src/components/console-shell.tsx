import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { dark } from '@clerk/themes';
import { Link } from '@tanstack/react-router';
import { FileText, MessageSquare, SquareTerminal, Tag } from 'lucide-react';

import { SignedIn, SignedOut, SignInButton, UserButton } from '@acme/auth';
import { NavUserSubscription } from '@acme/billing';
import { env } from '@acme/billing/env';
import { Button, StripeIcon } from '@acme/ui';

import { StatusBar } from './status-bar';

const ProfileIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 512 512"
    fill="currentColor"
  >
    <path d="M399 384.2C376.9 345.8 335.4 320 288 320H224c-47.4 0-88.9 25.8-111 64.2c35.2 39.2 86.2 63.8 143 63.8s107.8-24.7 143-63.8zM0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zm256 16a72 72 0 1 0 0-144 72 72 0 1 0 0 144z" />
  </svg>
);

interface NavItem {
  title: string;
  to: string;
  icon: LucideIcon;
}

// Same destinations as the Next.js sidebar — deliberately re-arranged into a
// dense icon rail to prove the shell can diverge while the routes/features match.
const navItems: NavItem[] = [
  { title: 'Chat', to: '/chat-assistant/{-$sessionId}', icon: MessageSquare },
  { title: 'Documents', to: '/admin', icon: FileText },
  { title: 'Pricing', to: '/pricing', icon: Tag },
];

/**
 * App-owned layout chrome: a fixed left rail + top bar in a dark, dense,
 * monospace "developer console" style. Shell/chrome is always app-owned
 * (ADR 0011); the feature components rendered inside `children` are untouched.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const [subscriptionModalOpen, setSubscriptionModalOpen] = useState(false);

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
            <UserButton
              appearance={{
                baseTheme: dark,
                elements: {
                  avatarBox: 'h-8 w-8',
                  userButtonPopoverCard: 'shadow-lg',
                  userButtonPopoverActionButton: 'text-sm',
                  userButtonPopoverActionButtonIcon: 'w-4 h-4',
                  userButtonPopoverActionButtonText: 'text-sm',
                  userButtonPopoverFooter: 'hidden',
                },
              }}
            >
              <UserButton.MenuItems>
                <UserButton.Action
                  label="View Subscription Details"
                  labelIcon={<ProfileIcon />}
                  onClick={() => setSubscriptionModalOpen(true)}
                />
                <UserButton.Action
                  label="Manage Billing"
                  labelIcon={<StripeIcon />}
                  onClick={() =>
                    window.open(
                      env.NEXT_PUBLIC_STRIPE_MANAGE_BILLING_URL,
                      '_blank',
                    )
                  }
                />
              </UserButton.MenuItems>
            </UserButton>
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

      <NavUserSubscription
        isOpen={subscriptionModalOpen}
        onOpenChange={setSubscriptionModalOpen}
      />
    </div>
  );
}
