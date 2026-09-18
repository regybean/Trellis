import { createFileRoute, redirect } from '@tanstack/react-router';

import { DocumentsPage } from '@acme/ingest';

import { getAuthState } from '../lib/auth';
import { redirectToSignIn } from '../lib/auth-redirect';

// Your own content, on its own route. It used to render inside `/admin` behind
// a `role === 'admin'` gate, which was coherent while the corpus was one
// admin-curated artifact and stopped being coherent once a Document belongs to
// a user. `/admin` is now about other people — user search, role promotion,
// billing; `/documents` is about yours.
//
// So the guard keeps only half of `/admin`'s: signed out is still invited in to
// sign-in carrying where they were headed, but there is no role branch, because
// there is no longer a role that could turn a signed-in user away. Ownership is
// enforced server-side — every ingest procedure is owner-scoped
// `protectedProcedure` — and this guard only stops the page mounting, and its
// tRPC reads firing, while unauthenticated.
export const Route = createFileRoute('/documents')({
  beforeLoad: async ({ location }) => {
    const { userId } = await getAuthState();
    if (!userId) {
      throw redirect(redirectToSignIn(location.href));
    }
  },
  component: DocumentsRoute,
});

// The heading and the padding are app-owned; the master-detail inside is the
// feature's.
function DocumentsRoute() {
  return (
    <div className="min-h-full flex-grow space-y-6 p-5">
      <h1 className="font-mono text-2xl font-semibold">documents</h1>
      <DocumentsPage />
    </div>
  );
}
