'use client';

import { useState } from 'react';
import { Database } from 'lucide-react';

import { Button } from '@acme/ui';

import type { DataSourceSummary } from '../hooks/use-documents-page';
import { IngestUploadProvider } from '../hooks/ingest-upload-context';
import { useDocumentsPage } from '../hooks/use-documents-page';
import { DataSourceRail } from './data-source-rail';
import { DeleteDataSourceDialog } from './delete-data-source-dialog';
import { DocumentsList } from './documents-list';
import { IngestProgressView } from './ingest-progress';
import { UploadDocumentsDialog } from './upload-documents-dialog';

/**
 * The documents page: master-detail on the Data Source.
 *
 * The page is a feature surface, not chrome — the rail, the detail pane, the
 * upload dialog and the scoped progress panel all share one piece of state
 * (which Source you are standing in), so composing them in each app would mean
 * four apps each re-deriving it. Apps still own the heading and the padding
 * around this.
 *
 * `IngestUploadProvider` is mounted here rather than by the app because the
 * always-on progress subscription is page-scoped: mounting the provider IS what
 * scopes the tail, and the pieces that read it are all inside this component.
 */
export function DocumentsPage() {
  return (
    <IngestUploadProvider>
      <DocumentsExplorer />
    </IngestUploadProvider>
  );
}

function DocumentsExplorer() {
  const page = useDocumentsPage();
  // The user wants the dialog: no server state says that, and no cache entry
  // can. Both dialogs hold the intent and nothing else — the rows they act on
  // are resolved from the live list below.
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Resolved every render, never snapshotted: the dialog states the Source's
  // document count, and a count frozen at open-time goes stale the moment
  // `documents.list` invalidates under it.
  const pendingDelete =
    page.sources.find((source) => source.id === pendingDeleteId) ?? null;

  // Friction tracks consequence: an empty Source goes immediately, a populated
  // one goes through the type-the-name confirm. The asymmetry lives here
  // because the count is the thing that decides it, and the rail's trash does
  // not know the count's meaning.
  const requestDelete = (source: DataSourceSummary) => {
    if (source.documentCount === 0) {
      page.deleteDataSource(source.id);
      return;
    }
    setPendingDeleteId(source.id);
  };

  const hasNoSources = !page.isLoading && page.sources.length === 0;

  return (
    <div className="flex gap-6">
      <DataSourceRail
        sources={page.sources}
        selectedId={page.selected?.id ?? null}
        onSelect={page.select}
        totalDocumentCount={page.totalDocumentCount}
        maxDataSourcesPerUser={page.maxDataSourcesPerUser}
        atCap={page.atDataSourceCap}
        onCreate={page.createDataSource}
        isCreating={page.isCreating}
        onDelete={requestDelete}
      />

      <div className="min-w-0 flex-1 space-y-4">
        {hasNoSources ? (
          // No Sources at all: explain what one IS before asking for a name.
          // Upload is the action rather than "create a data source", because
          // upload is the entry point and the create happens inside the dialog.
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Database className="text-muted-foreground h-8 w-8" />
            <h3 className="text-lg font-medium">No data sources yet</h3>
            <p className="text-muted-foreground max-w-md text-sm">
              A data source is a private collection of your documents. The
              assistant searches only the data sources you pick for a message,
              so keeping work and personal files apart keeps them apart in
              answers too.
            </p>
            <Button onClick={() => setIsUploadOpen(true)}>
              Upload documents
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">
                {page.selected?.name ?? 'All documents'}
              </h2>
              <Button onClick={() => setIsUploadOpen(true)}>
                Upload documents
              </Button>
            </div>

            {/* Two regions, in this order: the accented in-flight panel, then
                the labelled list of what has landed. Both are handed what the
                hook already narrowed to the selected Source — the panel renders
                nothing from the roll-up, which is what keeps progress with its
                destination. */}
            <IngestProgressView
              files={page.uploadsInView}
              summary={page.uploadsSummary}
            />

            <div className="space-y-2">
              <p className="text-muted-foreground text-xs font-medium uppercase">
                Documents
              </p>
              <DocumentsList
                documents={page.documentsInView}
                isLoading={page.isLoading}
                isRollUp={page.selected === null}
                onDelete={page.deleteDocument}
                isDeleting={page.isDeletingDocument}
                onRequestUpload={() => setIsUploadOpen(true)}
              />
            </div>
          </>
        )}
      </div>

      {/* Both dialogs are mounted only while they are open, so their fields
          start empty every time and there is no reset to remember. */}
      {isUploadOpen && (
        <UploadDocumentsDialog
          destination={page.selected}
          sources={page.sources}
          headroom={page.headroom}
          maxDocumentsPerDataSource={page.maxDocumentsPerDataSource}
          atSourceCap={page.atDataSourceCap}
          onCreateDataSource={page.createDataSource}
          onUploaded={page.select}
          onClose={() => setIsUploadOpen(false)}
        />
      )}

      {pendingDelete && (
        <DeleteDataSourceDialog
          source={pendingDelete}
          onConfirm={page.deleteDataSource}
          onClose={() => setPendingDeleteId(null)}
          isDeleting={page.isDeleting}
        />
      )}
    </div>
  );
}
