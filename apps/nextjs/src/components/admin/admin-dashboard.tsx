import 'server-only';

import { redirect } from 'next/navigation';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { Users } from 'lucide-react';

import { transformUserForClient } from '@acme/auth/server';
import { StripeTesting } from '@acme/billing';
import { DocumentsList, UploadDocumentsButton } from '@acme/ingest';
import { Card, CardContent, CardHeader } from '@acme/ui';

import { removeRole, setRole } from '~/lib/admin';
import { SearchUsers } from './search-users';
import { UserManagement } from './user-management';

interface Props {
  searchParams?: {
    search?: string;
  };
}

/**
 * App-owned admin shell (Next.js RSC). Reuses the neutral presentational pieces
 * (`UserManagement`, `StripeTesting`, ingest documents) and supplies the
 * `'use server'` role mutations from `~/lib/admin`. See ADR 0011.
 */
export async function AdminDashboard({ searchParams }: Props) {
  const { sessionClaims } = await auth();
  if (sessionClaims?.metadata.role !== 'admin') {
    redirect('/');
  }

  const query = searchParams?.search;

  const client = await clerkClient();
  const { data: users } = query
    ? await client.users.getUserList({ query })
    : await client.users.getUserList();

  // Transform users to serializable format for client components
  const serializableUsers = users.map((user) => transformUserForClient(user));

  return (
    <div className="mx-auto max-w-7xl px-4">
      {/* Header */}
      <div className="mx-auto max-w-4xl text-center">
        <h1 className="text-4xl font-extrabold sm:text-5xl">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-4 mb-8 text-xl">
          Document management & user administration
        </p>
      </div>

      <div className="space-y-12">
        {/* Document Knowledge Base */}
        <Card className="border-border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <h2 className="text-2xl font-bold">Documents</h2>
            <UploadDocumentsButton />
          </CardHeader>
          <CardContent>
            <DocumentsList />
          </CardContent>
        </Card>

        {/* User Management */}
        <div className="space-y-6">
          <Card className="border-border shadow-sm">
            <CardHeader></CardHeader>
            <CardContent>
              <SearchUsers />
            </CardContent>
          </Card>

          {serializableUsers.length > 0 && (
            <UserManagement
              users={serializableUsers}
              setRole={setRole}
              removeRole={removeRole}
            />
          )}

          {/* Stripe Testing Section */}
          <StripeTesting />

          {query && serializableUsers.length === 0 && (
            <Card className="border-border shadow-xs">
              <CardContent className="py-8 text-center">
                <Users className="text-muted-foreground/50 mx-auto h-12 w-12" />
                <h3 className="text-foreground mt-4 text-lg font-medium">
                  No users found
                </h3>
                <p className="text-muted-foreground mt-2">
                  No users match your search criteria. Try a different search
                  term.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
