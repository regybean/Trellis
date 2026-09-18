import { DocumentsPage as IngestDocumentsPage } from '@acme/ingest';

// Your own content, on its own route. It used to render inside `/admin` behind
// a `role === 'admin'` gate, which was coherent while the corpus was one
// admin-curated artifact and stopped being coherent once a Document belongs to
// a user. `/admin` is now about other people — user search, role promotion,
// billing; `/documents` is about yours. The gate left with the move: middleware
// bounces a signed-out visitor to sign-in, and every ingest procedure is
// owner-scoped `protectedProcedure`, so any signed-in user lands here and sees
// only their own Data Sources.
//
// The heading and the padding are app-owned; the master-detail inside is the
// feature's.
export default function DocumentsRoute() {
  return (
    <div className="bg-background min-h-screen flex-grow space-y-6 p-5">
      <h1 className="font-serif text-4xl font-semibold tracking-tight">
        Documents
      </h1>
      <IngestDocumentsPage />
    </div>
  );
}
