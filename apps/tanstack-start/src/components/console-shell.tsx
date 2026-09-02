import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileText, MessageSquare, SquareTerminal, Tag } from 'lucide-react';

import type { UserButtonUser } from '@acme/ui';
import { NavUserSubscription, useBillingConfig } from '@acme/billing';
import { Button, DropdownMenuItem, StripeIcon, UserButton } from '@acme/ui';

import { authClient } from '../lib/auth-client';
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
 *
 * `user` is the signed-in principal or `null`, resolved on the server by
 * `__root`'s `beforeLoad` and passed down as a prop. Under Clerk this was
 * `<SignedIn>` / `<SignedOut>` reading provider context, which meant the rail
 * rendered its signed-out state first and swapped once Clerk hydrated; a
 * server-resolved prop paints the right one immediately (ADR 0034).
 */
export function ConsoleShell({
  user,
  children,
}: {
  user: UserButtonUser | null;
  children: ReactNode;
}) {
  const [subscriptionModalOpen, setSubscriptionModalOpen] = useState(false);
  const navigate = useNavigate();
  // The billing-portal URL comes through the provider the root route mounts, not
  // from this app's composed `env`: the values the browser sees are the ones the
  // server threaded across the SSR boundary (ADR 0033 §6).
  const billing = useBillingConfig();

  // A document load, not an SPA transition: signing out has to drop the app's
  // QueryClient and the feature IndexedDB persisters, which are keyed on the
  // departing user's id at mount (see PersistedFeatureProviders). `signOut` deletes the
  // `session` row and clears the cookie, so the reload lands signed out.
  //
  // The reload is in a `finally` because it has to happen either way. If
  // `signOut` rejects — offline, or the row is already gone — skipping it would
  // leave the browser sitting in a UI that still says "signed in", with stale
  // per-user caches mounted, which is the worse of the two failures. Reloading
  // re-resolves the session on the server and renders whatever is actually true.
  const signOut = async () => {
    try {
      await authClient.signOut();
    } finally {
      await navigate({ to: '/', reloadDocument: true });
    }
  };

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
          {user ? (
            <UserButton
              user={user}
              onSignOut={() => void signOut()}
              menuItems={
                <>
                  <DropdownMenuItem
                    onSelect={() => setSubscriptionModalOpen(true)}
                  >
                    <ProfileIcon />
                    View Subscription Details
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      window.open(billing.STRIPE_MANAGE_BILLING_URL, '_blank')
                    }
                  >
                    <StripeIcon />
                    Manage Billing
                  </DropdownMenuItem>
                </>
              }
            />
          ) : (
            <Button asChild size="sm" className="w-full font-mono text-xs">
              <Link to="/sign-in">sign in</Link>
            </Button>
          )}
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
