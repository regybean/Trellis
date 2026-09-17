'use client';

import { Trash2 } from 'lucide-react';

import { Button } from '@acme/ui';

import { useDocuments } from '../hooks/use-documents';

/**
 * The detail pane's Document list — the right-hand half of the master-detail.
 *
 * `dataSourceId` is where the user is standing: a Source id narrows the list to
 * it, and `undefined` is the `All documents` roll-up, which is the only mode
 * that prints a Source name on each row (inside one Source the name would be
 * the same word repeated down the column).
 *
 * The narrowing is client-side over the roll-up query on purpose. One
 * `documents.list` fetch feeds every pane and every rail count, so switching
 * Sources is instant and the persisted snapshot is one key rather than one per
 * Source. The corpus is capped at 10 Sources x 50 Documents, so the list it
 * filters is bounded by construction.
 *
 * Deleting a Document is a hover-revealed trash with NO confirmation. That is
 * the light end of the page's deliberate asymmetry: one file, re-uploadable in
 * seconds. The heavy end is deleting a Source that still has Documents, which
 * demands its name typed out.
 */
export function DocumentsList({
  dataSourceId,
  onRequestUpload,
}: {
  dataSourceId?: string;
  onRequestUpload?: () => void;
}) {
  const { documents, isLoading, deleteDocument, isDeleting } = useDocuments();

  const visible = dataSourceId
    ? documents.filter((doc) => doc.dataSourceId === dataSourceId)
    : documents;

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading documents…</p>;
  }

  if (visible.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No documents uploaded yet.{' '}
        {onRequestUpload && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 align-baseline"
            onClick={onRequestUpload}
          >
            Upload documents
          </Button>
        )}
      </p>
    );
  }

  return (
    <ul className="divide-border divide-y">
      {visible.map((doc) => (
        // The same filename in two Sources is two Documents, so the row key is
        // the pair rather than the filename.
        <li
          key={`${doc.dataSourceId}:${doc.filename}`}
          className="group flex items-center justify-between py-2"
        >
          <div>
            <p className="text-sm font-medium">{doc.filename}</p>
            <p className="text-muted-foreground text-xs">
              {/* The Source name earns its place only in the roll-up. */}
              {dataSourceId ? null : `${doc.dataSourceName} · `}
              {doc.count} chunks
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={isDeleting}
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => deleteDocument(doc.dataSourceId, doc.filename)}
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">
              Delete {doc.filename} from {doc.dataSourceName}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
