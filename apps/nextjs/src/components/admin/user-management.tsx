'use client';

import { useState } from 'react';
import { Mail, Settings, Shield, UserIcon } from 'lucide-react';

import type { SerializableUser } from '@acme/auth';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@acme/ui';

import { UserDetailedManagement } from './user-detailed-management';

const getRoleBadgeVariant = (role?: 'user' | 'admin') =>
  role === 'admin' ? 'default' : 'secondary';

const getRoleIcon = (role?: 'user' | 'admin') =>
  role === 'admin' ? (
    <Shield className="text-foreground h-3 w-3" />
  ) : (
    <UserIcon className="text-foreground h-3 w-3" />
  );

const getUserRole = (user: SerializableUser): 'user' | 'admin' =>
  user.publicMetadata.role ?? 'user';

const getEmailInitials = (email: string): string => {
  const parts = email.split('@')[0] ?? '';
  return parts.slice(0, 2).toUpperCase();
};

interface UserManagementProps {
  users: SerializableUser[];
  setRole: (formData: FormData) => Promise<void>;
  removeRole: (formData: FormData) => Promise<void>;
}

export function UserManagement({
  users,
  setRole,
  removeRole,
}: UserManagementProps) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const selectedUser = users.find((user) => user.id === selectedUserId);

  const handleOpenUserManagement = (userId: string) => {
    setSelectedUserId(userId);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedUserId(null);
  };

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
              const primaryEmail =
                user.emailAddresses.find(
                  (email) => email.id === user.primaryEmailAddressId,
                )?.emailAddress ?? 'No email';

              const emailInitials = getEmailInitials(primaryEmail);
              const userRole = getUserRole(user);

              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-6"
                >
                  <div className="flex items-center space-x-4">
                    <Avatar className="h-10 w-10">
                      <AvatarImage
                        src={user.imageUrl || '/placeholder.svg'}
                        alt={primaryEmail}
                      />
                      <AvatarFallback className="bg-primary text-on-primary text-sm">
                        {emailInitials}
                      </AvatarFallback>
                    </Avatar>

                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <div className="flex items-center space-x-1">
                          <Mail className="text-muted-foreground h-4 w-4" />
                          <h3 className="text-foreground font-medium">
                            {primaryEmail}
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
                        User ID: {user.id}
                      </p>
                    </div>
                  </div>

                  <Button
                    variant="default"
                    onClick={() => handleOpenUserManagement(user.id)}
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
      <Dialog open={isModalOpen} onOpenChange={handleCloseModal}>
        <DialogContent className="max-h-[80vh] w-full overflow-y-auto sm:max-w-[min(90rem,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>User Management</DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <UserDetailedManagement
              user={selectedUser}
              setRole={setRole}
              removeRole={removeRole}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
