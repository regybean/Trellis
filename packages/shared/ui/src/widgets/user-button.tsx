'use client';

import { ChevronsUpDown, LogOut } from 'lucide-react';

import { cn } from '../../src/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  className?: string;
}

const getInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase();

export function UserButton({ user, onSignOut, className }: UserButtonProps) {
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
            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
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
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
