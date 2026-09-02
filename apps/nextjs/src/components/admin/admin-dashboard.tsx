import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';

import { readSessionRole, toManagementUser } from '@acme/auth/server';
import {
  RateLimitManagement,
  StripeTesting,
  TierManagement,
} from '@acme/billing';
import {
  DocumentsList,
  IngestProgress,
  IngestUploadProvider,
  UploadDocumentsButton,
} from '@acme/ingest';
import { Card, CardContent, CardHeader, UserManagement } from '@acme/ui';

import { removeRole, setRole } from '~/lib/admin';
import { auth } from '~/server/auth';
import { SearchUsers } from './search-users';

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
  const requestHeaders = await headers();

  // The authoritative admin gate for this page. Middleware cannot make this
  // call — the role is not in the session cookie and the Edge runtime has no
  // database — so the check lives here, where the session row is readable.
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session || readSessionRole(session.user) !== 'admin') {
    redirect('/');
  }

  const query = searchParams?.search;

  const { users } = await auth.api.listUsers({
    query: query
      ? { searchField: 'email', searchOperator: 'contains', searchValue: query }
      : {},
    headers: requestHeaders,
  });

  const managementUsers = users.map((user) => toManagementUser(user));

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
        <IngestUploadProvider>
          <Card className="border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <h2 className="text-2xl font-bold">Documents</h2>
              <UploadDocumentsButton />
            </CardHeader>
            <CardContent>
              <IngestProgress />
              <DocumentsList />
            </CardContent>
          </Card>
        </IngestUploadProvider>

        {/* User Management */}
        <div className="space-y-6">
          <Card className="border-border shadow-sm">
            <CardHeader></CardHeader>
            <CardContent>
              <SearchUsers />
            </CardContent>
          </Card>

          {managementUsers.length > 0 && (
            <UserManagement
              users={managementUsers}
              setRole={setRole}
              removeRole={removeRole}
              renderBillingPanels={(user) => (
                <>
                  <RateLimitManagement user={user} />
                  <TierManagement user={user} />
                </>
              )}
            />
          )}

          {/* Stripe Testing Section */}
          <StripeTesting />

          {query && managementUsers.length === 0 && (
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
