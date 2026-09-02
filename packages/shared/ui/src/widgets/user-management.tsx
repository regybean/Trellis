'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { Mail, Settings, Shield, UserIcon } from 'lucide-react';

import type {
  UserManagementRole,
  UserManagementUser,
} from './user-detailed-management';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  getUserInitials,
  UserDetailedManagement,
} from './user-detailed-management';

const getRoleBadgeVariant = (role: UserManagementRole) =>
  role === 'admin' ? 'default' : 'secondary';

const getRoleIcon = (role: UserManagementRole) =>
  role === 'admin' ? (
    <Shield className="text-foreground h-3 w-3" />
  ) : (
    <UserIcon className="text-foreground h-3 w-3" />
  );

interface UserManagementProps {
  users: UserManagementUser[];
  /** Assign a role. See `UserDetailedManagement`'s prop of the same name. */
  setRole: (input: {
    userId: string;
    role: UserManagementRole;
  }) => void | Promise<void>;
  /**
   * App-supplied billing panels for the selected user, injected so `@acme/ui`
   * (shared) stays free of the `@acme/billing` feature dependency. Rendered
   * inside `UserDetailedManagement`; slim apps can omit it.
   */
  renderBillingPanels?: (user: UserManagementUser) => ReactNode;
}

export function UserManagement({
  users,
  setRole,
  renderBillingPanels,
}: UserManagementProps) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Derived, not a second piece of state: the dialog is open exactly when a
  // user is selected, so one `useState` cannot disagree with the other.
  const selectedUser = users.find((user) => user.id === selectedUserId);

  return (
    <>
      <Card className="border-border shadow-xs">
        <CardHeader>
          <CardTitle className="text-foreground">
            User Results ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-border divide-y">
            {users.map((user) => {
              const userRole = user.role ?? 'user';

              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-6"
                >
                  <div className="flex items-center space-x-4">
                    <Avatar className="h-10 w-10">
                      <AvatarImage
                        src={user.image ?? undefined}
                        alt={user.name}
                      />
                      <AvatarFallback className="bg-primary text-on-primary text-sm">
                        {getUserInitials(user)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <div className="flex items-center space-x-1">
                          <Mail className="text-muted-foreground h-4 w-4" />
                          <h3 className="text-foreground font-medium">
                            {user.email}
                          </h3>
                        </div>
                        <Badge
                          variant={getRoleBadgeVariant(userRole)}
                          className="flex items-center space-x-1"
                        >
                          {getRoleIcon(userRole)}
                          <span className="text-foreground capitalize">
                            {userRole}
                          </span>
                        </Badge>
                      </div>

                      <p className="text-muted-foreground text-xs">
                        {user.name} · User ID: {user.id}
                      </p>
                    </div>
                  </div>

                  <Button
                    variant="default"
                    onClick={() => setSelectedUserId(user.id)}
                    className="flex items-center space-x-2"
                  >
                    <Settings className="h-4 w-4" />
                    <span>User Management</span>
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* User Management Modal */}
      <Dialog
        open={selectedUser !== undefined}
        onOpenChange={() => setSelectedUserId(null)}
      >
        <DialogContent className="max-h-[80vh] w-full overflow-y-auto sm:max-w-[min(90rem,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>User Management</DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <UserDetailedManagement
              user={selectedUser}
              setRole={setRole}
              billingPanels={renderBillingPanels?.(selectedUser)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
