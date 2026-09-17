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
import { IngestProgress } from './ingest-progress';
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
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DataSourceSummary | null>(
    null,
  );

  const atSourceCap =
    page.maxDataSourcesPerUser !== undefined &&
    page.sources.length >= page.maxDataSourcesPerUser;

  // Friction tracks consequence: an empty Source goes immediately, a populated
  // one goes through the type-the-name confirm. The asymmetry lives here
  // because the count is the thing that decides it, and the rail's trash does
  // not know the count's meaning.
  const requestDelete = (source: DataSourceSummary) => {
    if (source.documentCount === 0) {
      page.deleteDataSource(source.id);
      return;
    }
    setPendingDelete(source);
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
                the labelled list of what has landed. */}
            <IngestProgress dataSourceId={page.selected?.id} />

            <div className="space-y-2">
              <p className="text-muted-foreground text-xs font-medium uppercase">
                Documents
              </p>
              <DocumentsList
                dataSourceId={page.selected?.id}
                onRequestUpload={() => setIsUploadOpen(true)}
              />
            </div>
          </>
        )}
      </div>

      <UploadDocumentsDialog
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        destination={page.selected}
        sources={page.sources}
        headroom={page.headroom}
        atSourceCap={atSourceCap}
        onCreateDataSource={page.createDataSource}
        onUploaded={page.select}
      />

      <DeleteDataSourceDialog
        source={pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={page.deleteDataSource}
        isDeleting={page.isDeleting}
      />
    </div>
  );
}
