import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { AdminDashboard } from '../components/admin/admin-dashboard';
import { listUsers } from '../lib/admin';
import { getAuthState } from '../lib/auth';

export const Route = createFileRoute('/admin')({
  validateSearch: z.object({ search: z.string().optional() }),
  loaderDeps: ({ search }) => ({ search: search.search }),
  beforeLoad: async () => {
    const { role } = await getAuthState();
    if (role !== 'admin') {
      throw redirect({ to: '/' });
    }
  },
  loader: ({ deps }) => listUsers({ data: { search: deps.search } }),
  component: AdminRoute,
});

function AdminRoute() {
  const users = Route.useLoaderData();
  const { search } = Route.useSearch();
  const navigate = useNavigate({ from: '/admin' });

  return (
    <div className="min-h-full flex-grow p-5">
      <AdminDashboard
        users={users}
        currentSearch={search ?? ''}
        onSearch={(query) => void navigate({ search: { search: query } })}
        onClear={() => void navigate({ search: {} })}
      />
    </div>
  );
}
