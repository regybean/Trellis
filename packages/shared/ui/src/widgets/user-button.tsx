'use client';

import type { ReactNode } from 'react';
import { ChevronsUpDown, LogOut } from 'lucide-react';

import { cn } from '../../src/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

/**
 * Minimal, UI-owned view of the signed-in principal. Declared here rather than
 * imported so `@acme/ui` (shared) takes no dependency on the auth seam, keeping
 * the slim apps' graph free of `@acme/auth` (ADR 0010) — the same idiom as
 * `UserManagementUser`. Callers pass their own session user.
 */
export interface UserButtonUser {
  name: string;
  email: string;
  imageUrl?: string | null;
}

interface UserButtonProps {
  user: UserButtonUser;
  /** Sign-out is the caller's call — this widget only triggers it. */
  onSignOut: () => void;
  /**
   * App-supplied extra menu entries (e.g. "Manage billing"), injected via prop
   * so `@acme/ui` stays free of feature dependencies. Rendered above sign-out.
   */
  menuItems?: ReactNode;
  className?: string;
}

const getInitials = (user: UserButtonUser): string => {
  const words = user.name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return (user.email.split('@')[0] ?? '?').slice(0, 2).toUpperCase();
  }

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase();
};

export function UserButton({
  user,
  onSignOut,
  menuItems,
  className,
}: UserButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            'h-auto w-full justify-start gap-2 px-2 py-1.5',
            className,
          )}
        >
          <Avatar>
            {user.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}
            <AvatarFallback>{getInitials(user)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 text-left">
            <span className="text-foreground block truncate text-sm font-medium">
              {user.name}
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              {user.email}
            </span>
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {menuItems && (
          <>
            {menuItems}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
