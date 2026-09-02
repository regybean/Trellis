import 'server-only';

import type { UserWithRole } from 'better-auth/plugins/admin';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';

import type { SerializableUser } from '@acme/auth';
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
import { parseRole, readRole } from '~/server/session';
import { SearchUsers } from './search-users';

interface Props {
  searchParams?: {
    search?: string;
  };
}

/**
 * Better Auth's user row → the `SerializableUser` shape `@acme/ui`'s
 * `UserManagement` and `@acme/billing`'s admin panels read.
 *
 * That shape is Clerk's, and it stays for now: reworking those widgets onto a
 * Better Auth-native user (and updating ADR 0013 with it) is a separate ticket,
 * so this adapter is what keeps the dashboard working with no Clerk dependency.
 *
 * Two fields have no equivalent and are mapped honestly rather than invented.
 * Better Auth keeps exactly one email per user, so `emailAddresses` is a single
 * entry which is also the primary — hence the shared id. And it records no
 * last-sign-in time on the user row (sessions carry that), so `lastSignInAt` is
 * null, which the widget already renders as "omit the line".
 */
function toSerializableUser(user: UserWithRole): SerializableUser {
  return {
    id: user.id,
    imageUrl: user.image ?? '',
    primaryEmailAddressId: user.id,
    emailAddresses: [{ id: user.id, emailAddress: user.email }],
    publicMetadata: { role: parseRole(user.role) ?? undefined },
    createdAt: user.createdAt.getTime(),
    lastSignInAt: null,
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
  if (
    readRole(await auth.api.getSession({ headers: requestHeaders })) !== 'admin'
  ) {
    redirect('/');
  }

  const query = searchParams?.search;

  const { users } = await auth.api.listUsers({
    query: query
      ? { searchField: 'email', searchOperator: 'contains', searchValue: query }
      : {},
    headers: requestHeaders,
  });

  const serializableUsers = users.map((user) => toSerializableUser(user));

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

          {serializableUsers.length > 0 && (
            <UserManagement
              users={serializableUsers}
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
