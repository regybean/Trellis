import { useRouter } from '@tanstack/react-router';
import { Users } from 'lucide-react';

import type { UserManagementUser } from '@acme/ui';
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

import { setUserRole } from '../../lib/admin';
import { SearchUsers } from './search-users';

interface AdminDashboardProps {
  users: UserManagementUser[];
  currentSearch: string;
  onSearch: (query: string) => void;
  onClear: () => void;
}

/**
 * App-owned admin shell — the framework-specific replacement for the Next.js
 * `AdminDashboard` RSC. It reuses the neutral presentational pieces
 * (`UserManagement`, `StripeTesting`, ingest documents) unchanged and binds the
 * role mutation to a TanStack Start server function.
 *
 * The adapter that used to sit here is gone: `UserManagement` took
 * `(FormData) => Promise<void>`, a Next.js server-action signature, so this
 * component had to read fields back out of a `FormData` the widget had built for
 * no one. It now takes a typed callback (#225), and the only per-app work left
 * is invalidating the router so the loader re-reads the list.
 */
export function AdminDashboard({
  users,
  currentSearch,
  onSearch,
  onClear,
}: AdminDashboardProps) {
  const router = useRouter();

  const setRole = async (data: { userId: string; role: 'admin' | 'user' }) => {
    await setUserRole({ data });
    await router.invalidate();
  };

  return (
    <div className="mx-auto max-w-7xl px-4">
      <div className="mx-auto max-w-4xl text-center">
        <h1 className="text-4xl font-extrabold sm:text-5xl">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-4 mb-8 text-xl">
          Document management & user administration
        </p>
      </div>

      <div className="space-y-12">
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

        <div className="space-y-6">
          <Card className="border-border shadow-sm">
            <CardHeader></CardHeader>
            <CardContent>
              <SearchUsers
                key={currentSearch}
                currentSearch={currentSearch}
                onSubmit={onSearch}
                onClear={onClear}
              />
            </CardContent>
          </Card>

          {users.length > 0 && (
            <UserManagement
              users={users}
              setRole={setRole}
              renderBillingPanels={(user) => (
                <>
                  <RateLimitManagement user={user} />
                  <TierManagement user={user} />
                </>
              )}
            />
          )}

          <StripeTesting />

          {currentSearch && users.length === 0 && (
            <Card className="border-border shadow-xs">
              <CardContent className="py-8 text-center">
                <Users className="text-muted-foreground/50 mx-auto h-12 w-12" />
                <h3 className="mt-4 text-lg font-medium">No users found</h3>
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
