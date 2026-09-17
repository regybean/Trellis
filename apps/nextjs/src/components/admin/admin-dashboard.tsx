import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';

import { readSessionRole, toAdminUser } from '@acme/auth/server';
import {
  RateLimitManagement,
  StripeTesting,
  TierManagement,
} from '@acme/billing';
import { Card, CardContent, CardHeader, UserManagement } from '@acme/ui';

import { setRole } from '~/lib/admin';
import { auth } from '~/server/auth';
import { SearchUsers } from './search-users';

interface Props {
  searchParams?: {
    search?: string;
  };
}

/**
 * App-owned admin shell (Next.js RSC). Reuses the neutral presentational pieces
 * (`UserManagement`, `StripeTesting`) and supplies the `'use server'` role
 * mutations from `~/lib/admin`. See ADR 0011.
 *
 * This page is about **other people**: user search, role promotion, billing.
 * Documents left for `/documents` when they stopped being one admin-curated
 * corpus and became a user's own content — so there is deliberately no
 * cross-user document view here at all, additive later if moderation needs one.
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

  const managementUsers = users.map((user) => toAdminUser(user));

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
