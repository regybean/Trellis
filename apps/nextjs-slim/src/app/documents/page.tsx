'use client';

import { DocumentsList, UploadDocumentsButton } from '@acme/ingest';

// The slim app's documents view. The full app routed "Documents" at `/admin`
// via `@acme/admin`'s `AdminDashboard` — a non-modular fuse of document
// management + Clerk user management + Stripe testing. Slim drops that
// composition and renders the clean `@acme/ingest` document UI directly.
function DocumentsPage() {
  return (
    <div className="bg-background min-h-screen flex-grow space-y-6 p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Documents</h1>
        <UploadDocumentsButton />
      </div>
      <DocumentsList />
    </div>
  );
}
export default DocumentsPage;
