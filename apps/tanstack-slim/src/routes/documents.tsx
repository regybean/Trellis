import { createFileRoute } from '@tanstack/react-router';

import { DocumentsPage } from '@acme/ingest';

export const Route = createFileRoute('/documents')({
  component: DocumentsRoute,
});

// The slim app's documents view. The full app still routes "Documents" at
// `/admin` via an app-owned `AdminDashboard` that fuses document management +
// user management + Stripe testing. Slim drops all of that and renders the
// `@acme/ingest` documents page directly — the heading and the padding are
// app-owned, the master-detail inside is the feature's.
function DocumentsRoute() {
  return (
    <div className="min-h-full flex-grow space-y-6 p-5">
      <h1 className="font-mono text-2xl font-semibold">documents</h1>
      <DocumentsPage />
    </div>
  );
}
