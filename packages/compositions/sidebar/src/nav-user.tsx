'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { dark } from '@clerk/themes';
import { Moon, Sun, User } from 'lucide-react';
import { useTheme } from 'next-themes';

import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
  useUser,
} from '@acme/auth';
import { NavUserSubscription } from '@acme/billing';
import { env } from '@acme/billing/env';
import {
  Button,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  StripeIcon,
  useSidebar,
} from '@acme/ui';

const ProfileIcon = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      fill="currentColor"
    >
      <path d="M399 384.2C376.9 345.8 335.4 320 288 320H224c-47.4 0-88.9 25.8-111 64.2c35.2 39.2 86.2 63.8 143 63.8s107.8-24.7 143-63.8zM0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zm256 16a72 72 0 1 0 0-144 72 72 0 1 0 0 144z" />
    </svg>
  );
};

const ThemeIcon = () => (
  <div className="relative">
    <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
    <Moon className="absolute top-0 h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
  </div>
);

export function NavUser() {
  const [subscriptionModalOpen, setSubscriptionModalOpen] = useState(false);
  const { user } = useUser();
  const { state } = useSidebar();
  const router = useRouter();
  const isCollapsed = state === 'collapsed';

  const { setTheme, theme, resolvedTheme } = useTheme();
  const currentThemeName = theme ?? 'system';
  const currentThemeLabel =
    currentThemeName.charAt(0).toUpperCase() + currentThemeName.slice(1);

  const handleSubscriptionClick = () => {
    setSubscriptionModalOpen(true);
  };

  const handleThemeToggle = () => {
    if (theme === 'light') {
      setTheme('dark');
    } else if (theme === 'dark') {
      setTheme('system');
    } else {
      setTheme('light');
    }
  };

  const handleSignInClick = () => {
    router.push('/sign-in');
  };

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SignedOut>
            {/* Collapsed view - show user icon that navigates to sign-in */}
            {isCollapsed ? (
              <SidebarMenuButton
                tooltip="Sign In"
                onClick={handleSignInClick}
                className="flex items-center justify-center"
              >
                <User className="h-4 w-4" />
              </SidebarMenuButton>
            ) : (
              <div className="border-sidebar-border bg-sidebar flex w-full items-center gap-2 rounded-md border p-2 shadow-sm">
                <Button
                  variant="secondary"
                  size="sm"
                  className="hover:bg-sidebar-accent border-input flex-1 border transition-colors"
                  asChild
                >
                  <SignUpButton />
                </Button>
                <Button size="sm" className="flex-1" asChild>
                  <SignInButton />
                </Button>
              </div>
            )}
          </SignedOut>
          <SignedIn>
            {/* Collapsed view - show just the UserButton avatar */}
            {isCollapsed ? (
              <div className="flex items-center justify-center">
                <UserButton
                  appearance={{
                    baseTheme: resolvedTheme === 'dark' ? dark : undefined,
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
                      onClick={handleSubscriptionClick}
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
                    <UserButton.Action
                      label={`Theme: ${currentThemeLabel}`}
                      labelIcon={<ThemeIcon />}
                      onClick={handleThemeToggle}
                    />
                  </UserButton.MenuItems>
                </UserButton>
              </div>
            ) : (
              <div className="border-sidebar-border bg-sidebar group hover:bg-sidebar-accent relative flex w-full min-w-0 cursor-pointer items-center gap-3 overflow-hidden rounded-md border p-2 shadow-sm transition-colors">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <UserButton
                    appearance={{
                      baseTheme: resolvedTheme === 'dark' ? dark : undefined,
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
                        onClick={handleSubscriptionClick}
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
                      <UserButton.Action
                        label={`Theme: ${currentThemeLabel}`}
                        labelIcon={<ThemeIcon />}
                        onClick={handleThemeToggle}
                      />
                    </UserButton.MenuItems>
                  </UserButton>
                  <span className="text-sidebar-foreground truncate text-sm break-words">
                    {user?.primaryEmailAddress?.emailAddress}
                  </span>
                </div>
                {/* Invisible overlay to make entire button clickable */}
                <div
                  className="absolute inset-0 z-10"
                  onClick={(e) => {
                    const userButton =
                      e.currentTarget.parentElement?.querySelector('button');
                    userButton?.click();
                  }}
                />
              </div>
            )}
          </SignedIn>
        </SidebarMenuItem>
      </SidebarMenu>

      <NavUserSubscription
        isOpen={subscriptionModalOpen}
        onOpenChange={setSubscriptionModalOpen}
      />
    </>
  );
}
