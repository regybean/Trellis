'use client';

import { DocumentsPage as IngestDocumentsPage } from '@acme/ingest';

// The slim app's documents view. The full app has the same route now — it used
// to fuse document management into an admin-gated dashboard, and Documents
// moved out to `/documents` once they became a user's own content. What stays
// different is the gate: the full app requires a signed-in principal, while
// this app resolves no session at all and hands every request the same constant
// one. The heading and the padding are app-owned, the master-detail inside is
// the feature's.
function DocumentsPage() {
  return (
    <div className="bg-background min-h-screen flex-grow space-y-6 p-5">
      <h1 className="text-2xl font-semibold">Documents</h1>
      <IngestDocumentsPage />
    </div>
  );
}
export default DocumentsPage;
