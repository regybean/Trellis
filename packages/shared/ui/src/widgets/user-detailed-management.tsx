'use client';

import type { ReactNode } from 'react';
import {
  BadgeCheck,
  Mail,
  MoreHorizontal,
  Shield,
  User,
  UserIcon,
  Users,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

/** The roles the admin surface can assign. Mirrors `@acme/trpc`'s `Roles`. */
export type UserManagementRole = 'user' | 'admin';

/**
 * A user as the admin widgets render it — Better Auth's own user row, minus the
 * columns these widgets don't show.
 *
 * Declared here, rather than imported from `@acme/auth`, so `@acme/ui` (shared)
 * takes no dependency on the auth seam and the slim apps' graph stays free of it
 * (ADR 0010). The edge runs the other way: `@acme/auth` names this type to
 * describe what its adapter returns.
 *
 * Every field is one Better Auth actually stores. Until #225 this carried an
 * `emailAddresses` array with a `primaryEmailAddressId` pointing into it and a
 * `lastSignInAt`, neither of which had a source behind it (ADR 0034): Better
 * Auth keeps exactly one email per user (it is the row's unique key) and records
 * no last-sign-in. Both are gone rather than faked.
 *
 * `role` is optional because it is a nullable free-text column that Better Auth
 * omits from `getSession`'s static type; an absent value reads as the default,
 * `user`. Narrowing that column to this union is `@acme/auth`'s job — this
 * package states the union it renders and does not parse.
 */
export interface UserManagementUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  role?: UserManagementRole;
}

interface UserDetailedManagementProps {
  user: UserManagementUser;
  /**
   * Assign a role. One callback covers promotion and demotion because Better
   * Auth has no "no role" state to return to — `role` is a column defaulting to
   * `user`, not a nullable metadata bag — so demoting *is* assigning `user`. The
   * old `removeRole` prop was a second name for this call.
   *
   * A plain typed callback, not the `(FormData) => Promise<void>` server-action
   * signature this took until #225: that shape is Next.js's, and it forced the
   * TanStack Start app to manufacture a `FormData` to satisfy a
   * framework-neutral package. Each app binds this to whatever it uses.
   *
   * The return type admits a promise because an app may need to await its own
   * follow-up work (TanStack Start invalidates the router after the mutation);
   * this widget neither awaits nor renders anything from it.
   */
  setRole: (input: {
    userId: string;
    role: UserManagementRole;
  }) => void | Promise<void>;
  /**
   * App-supplied billing panels (e.g. `@acme/billing`'s `RateLimitManagement` /
   * `TierManagement`). Injected via prop so `@acme/ui` stays free of the billing
   * feature dependency — the exact coupling ADR 0011 folded these back into apps
   * over. Slim apps can omit it.
   */
  billingPanels?: ReactNode;
}

const getRoleBadgeVariant = (role: UserManagementRole) =>
  role === 'admin' ? 'default' : 'secondary';

const getRoleIcon = (role: UserManagementRole) =>
  role === 'admin' ? (
    <Shield className="text-foreground h-3 w-3" />
  ) : (
    <UserIcon className="text-foreground h-3 w-3" />
  );

/**
 * Initials for the avatar fallback. Prefers the display name Better Auth
 * requires on every user row, and falls back to the email local part for a row
 * whose name is blank.
 */
export const getUserInitials = (user: UserManagementUser): string => {
  const source = user.name.trim() || (user.email.split('@')[0] ?? '');
  return source.slice(0, 2).toUpperCase();
};

export function UserDetailedManagement({
  user,
  setRole,
  billingPanels,
}: UserDetailedManagementProps) {
  const userRole = user.role ?? 'user';

  return (
    <div className="space-y-6">
      {/* User Header */}
      <Card className="border-border shadow-xs">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center">
            <User className="text-accent-foreground mr-2 h-5 w-5" />
            User Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={user.image ?? undefined} alt={user.name} />
              <AvatarFallback className="bg-primary text-on-primary text-lg">
                {getUserInitials(user)}
              </AvatarFallback>
            </Avatar>

            <div className="space-y-2">
              <h3 className="text-foreground text-lg font-medium">
                {user.name}
              </h3>
              <div className="flex items-center space-x-2">
                <Mail className="text-muted-foreground h-4 w-4" />
                <span className="text-foreground text-sm">{user.email}</span>
                <Badge
                  variant={user.emailVerified ? 'default' : 'secondary'}
                  className="flex items-center space-x-1"
                >
                  <BadgeCheck className="text-foreground h-3 w-3" />
                  <span className="text-foreground">
                    {user.emailVerified ? 'Verified' : 'Unverified'}
                  </span>
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                User ID: {user.id}
              </p>
              <p className="text-muted-foreground text-sm">
                Created: {user.createdAt.toLocaleDateString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Management Actions */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Role Management */}
        <Card className="border-border shadow-xs">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center">
              <Users className="text-accent-foreground mr-2 h-5 w-5" />
              Role Management
            </CardTitle>
            <div className="text-muted-foreground text-sm">
              User: {user.email} (ID: {user.id})
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Badge
                  variant={getRoleBadgeVariant(userRole)}
                  className="flex items-center space-x-1"
                >
                  {getRoleIcon(userRole)}
                  <span className="text-foreground capitalize">{userRole}</span>
                </Badge>
                <span className="text-muted-foreground text-sm">
                  Current Role
                </span>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="text-muted-foreground hover:bg-accent hover:text-foreground h-8 w-8 p-0"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Open menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="border-border bg-background w-48 shadow-lg"
                  sideOffset={5}
                >
                  <DropdownMenuItem
                    disabled={userRole === 'admin'}
                    onSelect={() => setRole({ userId: user.id, role: 'admin' })}
                    className="text-foreground flex cursor-pointer items-center space-x-2"
                  >
                    <Shield className="h-4 w-4" />
                    <span>Make Admin</span>
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    disabled={userRole === 'user'}
                    onSelect={() => setRole({ userId: user.id, role: 'user' })}
                    className="text-foreground flex cursor-pointer items-center space-x-2"
                  >
                    <UserIcon className="h-4 w-4" />
                    <span>Make User</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardContent>
        </Card>

        {billingPanels}
      </div>
    </div>
  );
}
