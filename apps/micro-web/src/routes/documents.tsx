import { createFileRoute } from '@tanstack/react-router';

import { DocumentsList, UploadDocumentsButton } from '@acme/ingest';

export const Route = createFileRoute('/documents')({
  component: DocumentsRoute,
});

// The slim app's documents view. The full app routes "Documents" at `/admin`
// via an app-owned `AdminDashboard` that fuses document management + Clerk user
// management + Stripe testing. Slim drops all of that and renders the clean
// `@acme/ingest` document UI directly.
function DocumentsRoute() {
  return (
    <div className="min-h-full flex-grow space-y-6 p-5">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-2xl font-semibold">documents</h1>
        <UploadDocumentsButton />
      </div>
      <DocumentsList />
    </div>
  );
}
