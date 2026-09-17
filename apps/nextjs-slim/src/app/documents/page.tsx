'use client';

import { DocumentsPage as IngestDocumentsPage } from '@acme/ingest';

// The slim app's documents view. The full app still routes "Documents" at
// `/admin` via an app-owned `AdminDashboard` that fuses document management +
// user management + Stripe testing. Slim drops all of that and renders the
// `@acme/ingest` documents page directly — the heading and the padding are
// app-owned, the master-detail inside is the feature's.
function DocumentsPage() {
  return (
    <div className="bg-background min-h-screen flex-grow space-y-6 p-5">
      <h1 className="text-2xl font-semibold">Documents</h1>
      <IngestDocumentsPage />
    </div>
  );
}
export default DocumentsPage;
