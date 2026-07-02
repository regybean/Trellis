'use client';

import type { ReactNode } from 'react';
import {
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

/**
 * Minimal, UI-owned view of an admin-managed user. Structurally compatible with
 * `@acme/auth`'s `SerializableUser`, but declared here so `@acme/ui` (shared)
 * takes no dependency on the auth seam — keeping the slim apps' graph free of
 * `@acme/auth` (ADR 0010). Callers pass their own serializable user.
 */
export interface UserManagementUser {
  id: string;
  imageUrl: string;
  primaryEmailAddressId: string | null;
  emailAddresses: {
    id: string;
    emailAddress: string;
  }[];
  publicMetadata: {
    role?: 'user' | 'admin';
  };
  createdAt: number;
  lastSignInAt: number | null;
}

interface UserDetailedManagementProps {
  user: UserManagementUser;
  setRole: (formData: FormData) => Promise<void>;
  removeRole: (formData: FormData) => Promise<void>;
  /**
   * App-supplied billing panels (e.g. `@acme/billing`'s `RateLimitManagement` /
   * `TierManagement`). Injected via prop so `@acme/ui` stays free of the billing
   * feature dependency — the exact coupling ADR 0011 folded these back into apps
   * over. Slim apps can omit it.
   */
  billingPanels?: ReactNode;
}

const getRoleBadgeVariant = (role?: 'user' | 'admin') =>
  role === 'admin' ? 'default' : 'secondary';

const getRoleIcon = (role?: 'user' | 'admin') =>
  role === 'admin' ? (
    <Shield className="text-foreground h-3 w-3" />
  ) : (
    <UserIcon className="text-foreground h-3 w-3" />
  );

const getUserRole = (user: UserManagementUser): 'user' | 'admin' =>
  user.publicMetadata.role ?? 'user';

const getEmailInitials = (email: string): string => {
  const parts = email.split('@')[0] ?? '';
  return parts.slice(0, 2).toUpperCase();
};

export function UserDetailedManagement({
  user,
  setRole,
  removeRole,
  billingPanels,
}: UserDetailedManagementProps) {
  const primaryEmail =
    user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)
      ?.emailAddress ?? 'No email';

  const emailInitials = getEmailInitials(primaryEmail);
  const userRole = getUserRole(user);

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
              <AvatarImage
                src={user.imageUrl || '/placeholder.svg'}
                alt={primaryEmail}
              />
              <AvatarFallback className="bg-primary text-on-primary text-lg">
                {emailInitials}
              </AvatarFallback>
            </Avatar>

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Mail className="text-muted-foreground h-4 w-4" />
                <h3 className="text-foreground text-lg font-medium">
                  {primaryEmail}
                </h3>
              </div>
              <p className="text-muted-foreground text-sm">
                User ID: {user.id}
              </p>
              <p className="text-muted-foreground text-sm">
                Created: {new Date(user.createdAt).toLocaleDateString()}
              </p>
              {user.lastSignInAt && (
                <p className="text-muted-foreground text-sm">
                  Last Sign In:{' '}
                  {new Date(user.lastSignInAt).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Management Actions */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Clerk Role Management */}
        <Card className="border-border shadow-xs">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center">
              <Users className="text-accent-foreground mr-2 h-5 w-5" />
              Role Management
            </CardTitle>
            <div className="text-muted-foreground text-sm">
              User: {primaryEmail} (ID: {user.id})
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
                  <form action={setRole}>
                    <input type="hidden" value={user.id} name="id" />
                    <input type="hidden" value="admin" name="role" />
                    <DropdownMenuItem asChild>
                      <button
                        type="submit"
                        className="text-foreground hover:bg-accent focus:bg-accent flex w-full cursor-pointer items-center space-x-2 px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={userRole === 'admin'}
                      >
                        <Shield className="h-4 w-4" />
                        <span>Make Admin</span>
                      </button>
                    </DropdownMenuItem>
                  </form>

                  <form action={setRole}>
                    <input type="hidden" value={user.id} name="id" />
                    <input type="hidden" value="user" name="role" />
                    <DropdownMenuItem asChild>
                      <button
                        type="submit"
                        className="text-foreground hover:bg-accent focus:bg-accent flex w-full cursor-pointer items-center space-x-2 px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={userRole === 'user'}
                      >
                        <UserIcon className="h-4 w-4" />
                        <span>Make User</span>
                      </button>
                    </DropdownMenuItem>
                  </form>

                  <DropdownMenuSeparator className="bg-border" />

                  <form action={removeRole}>
                    <input type="hidden" value={user.id} name="id" />
                    <DropdownMenuItem asChild>
                      <button
                        type="submit"
                        className="text-error-text-red hover:bg-error-background-red focus:bg-error-background-red flex w-full cursor-pointer items-center space-x-2 px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={userRole === 'user'}
                      >
                        <UserIcon className="h-4 w-4" />
                        <span>Demote to User</span>
                      </button>
                    </DropdownMenuItem>
                  </form>
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
