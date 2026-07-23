'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { SignedIn, SignedOut, SignInButton, UserButton } from '@acme/auth';
import { Button, cn } from '@acme/ui';

interface NavItem {
  title: string;
  href: string;
}

// Destinations re-set as a horizontal masthead nav. The shell is app-owned
// (ADR 0011); feature components rendered in `children` are untouched and
// re-skin via the editorial tokens.
const navItems: NavItem[] = [
  { title: 'Chat', href: '/chat-assistant' },
  { title: 'Documents', href: '/admin' },
  { title: 'Pricing', href: '/pricing' },
];

/**
 * App-owned layout chrome in a print/magazine idiom: a two-tier masthead with a
 * serif wordmark, a meta strip, ruled horizontal navigation and a double rule.
 * Shell/chrome is always app-owned (ADR 0011) — proof the slice contract holds
 * while each app owns its own identity.
 */
export function EditorialShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="bg-background sticky top-0 z-40">
        {/* meta strip — small-caps mono kicker */}
        <div className="border-border text-muted-foreground flex items-center justify-between border-b px-6 py-1.5 font-mono text-[10px] tracking-[0.22em] uppercase">
          <span>Retrieval &middot; Augmented &middot; Generation</span>
          <span className="hidden sm:inline">
            Est. MMXXVI &mdash; The Knowledge Desk
          </span>
        </div>

        {/* masthead — serif wordmark + ruled nav */}
        <div className="border-border flex items-end justify-between gap-6 border-b-[3px] border-double px-6 pt-4 pb-3">
          <Link href="/" className="flex flex-col leading-none">
            <span className="text-foreground font-serif text-4xl font-semibold tracking-tight sm:text-5xl">
              Acme
            </span>
            <span className="text-muted-foreground mt-1 font-serif text-sm italic">
              a retrieval-augmented reader
            </span>
          </Link>

          <div className="flex items-center gap-6 pb-1">
            <nav className="hidden items-center gap-7 md:flex">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'relative font-sans text-xs tracking-[0.18em] uppercase transition-colors',
                    isActive(item.href)
                      ? 'text-primary'
                      : 'text-foreground hover:text-primary',
                  )}
                >
                  {item.title}
                  {isActive(item.href) && (
                    <span className="bg-primary absolute -bottom-1 left-0 h-px w-full" />
                  )}
                </Link>
              ))}
            </nav>

            <SignedIn>
              <UserButton />
            </SignedIn>
            <SignedOut>
              <SignInButton mode="modal">
                <Button
                  size="sm"
                  className="rounded-none font-sans text-xs tracking-[0.18em] uppercase"
                >
                  Sign in
                </Button>
              </SignInButton>
            </SignedOut>
          </div>
        </div>

        {/* mobile nav — horizontally scrollable rail */}
        <nav className="border-border flex items-center gap-5 overflow-x-auto border-b px-6 py-2 md:hidden">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'font-sans text-xs tracking-[0.18em] whitespace-nowrap uppercase',
                isActive(item.href) ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {item.title}
            </Link>
          ))}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>

      <footer className="border-border text-muted-foreground mt-auto border-t px-6 py-4 font-mono text-[10px] tracking-[0.18em] uppercase">
        &copy; MMXXVI Acme &mdash; set in Fraunces &amp; Hanken Grotesk
      </footer>
    </div>
  );
}
