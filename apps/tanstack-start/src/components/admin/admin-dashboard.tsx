import { useRouter } from '@tanstack/react-router';
import { Users } from 'lucide-react';

import type { SerializableUser } from '@acme/auth';
import { StripeTesting } from '@acme/billing';
import { DocumentsList, UploadDocumentsButton } from '@acme/ingest';
import { Card, CardContent, CardHeader } from '@acme/ui';

import { removeUserRole, setUserRole } from '../../lib/admin';
import { SearchUsers } from './search-users';
import { UserManagement } from './user-management';

interface AdminDashboardProps {
  users: SerializableUser[];
  currentSearch: string;
  onSearch: (query: string) => void;
  onClear: () => void;
}

// `formData.get` is `string | File | null`; the role form only ever submits a
// text id, so narrow to a string rather than blind-stringifying a File.
const getId = (formData: FormData) => {
  const id = formData.get('id');
  return typeof id === 'string' ? id : '';
};

/**
 * App-owned admin shell — the framework-specific replacement for the Next.js
 * `AdminDashboard` RSC. It reuses the neutral presentational pieces
 * (`UserManagement`, `StripeTesting`, ingest documents) unchanged and supplies
 * TanStack Start server functions for the role mutations, adapting them to the
 * `(FormData) => Promise<void>` contract `UserManagement` expects.
 */
export function AdminDashboard({
  users,
  currentSearch,
  onSearch,
  onClear,
}: AdminDashboardProps) {
  const router = useRouter();

  const setRole = async (formData: FormData) => {
    const role = formData.get('role') === 'admin' ? 'admin' : 'user';
    await setUserRole({ data: { id: getId(formData), role } });
    await router.invalidate();
  };

  const removeRole = async (formData: FormData) => {
    await removeUserRole({ data: { id: getId(formData) } });
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
        <Card className="border-border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <h2 className="text-2xl font-bold">Documents</h2>
            <UploadDocumentsButton />
          </CardHeader>
          <CardContent>
            <DocumentsList />
          </CardContent>
        </Card>

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
              removeRole={removeRole}
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
