import { createFileRoute } from '@tanstack/react-router';

import { DocumentsPage } from '@acme/ingest';

export const Route = createFileRoute('/documents')({
  component: DocumentsRoute,
});

// The slim app's documents view. The full app has the same route now — it used
// to fuse document management into an admin-gated dashboard, and Documents
// moved out to `/documents` once they became a user's own content. What stays
// different is the gate: the full app's route guard requires a signed-in
// principal, while this app resolves no session at all and hands every request
// the same constant one, so there is nothing to guard. The heading and the
// padding are app-owned, the master-detail inside is the feature's.
function DocumentsRoute() {
  return (
    <div className="min-h-full flex-grow space-y-6 p-5">
      <h1 className="font-mono text-2xl font-semibold">documents</h1>
      <DocumentsPage />
    </div>
  );
}
