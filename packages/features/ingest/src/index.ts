export const name = 'ingest';

// One surface, not five pieces. The rail, the detail pane, the upload dialog
// and the scoped progress panel share which Data Source the user is standing
// in, so an app composing them separately would have to own that state — and
// four apps would own four copies of it. Apps still own the heading and the
// page padding around this.
export { DocumentsPage } from './components/documents-page';
export {
  clearIngestPersistedCache,
  TRPCProvider as IngestTRPCProvider,
} from './trpc/react';
