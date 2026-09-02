import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { AdminDashboard } from '../components/admin/admin-dashboard';
import { listUsers } from '../lib/admin';
import { getAuthState } from '../lib/auth';
import { redirectToSignIn } from '../lib/auth-redirect';

export const Route = createFileRoute('/admin')({
  validateSearch: z.object({ search: z.string().optional() }),
  loaderDeps: ({ search }) => ({ search: search.search }),
  // Two outcomes, not one, mirroring the Next.js middleware: a signed-out
  // visitor is *invited in* (sign-in, carrying where they were headed), while a
  // signed-in non-admin is turned away to the home page. Bouncing the latter to
  // sign-in would loop them through a form that cannot change the answer.
  beforeLoad: async ({ location }) => {
    const { userId, role } = await getAuthState();
    if (!userId) {
      throw redirect(redirectToSignIn(location.href));
    }
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
