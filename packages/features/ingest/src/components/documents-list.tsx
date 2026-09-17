'use client';

import { Trash2 } from 'lucide-react';

import { Button } from '@acme/ui';

import type { DocumentRow } from '../hooks/use-documents-page';

/**
 * The detail pane's Document list — the right-hand half of the master-detail.
 *
 * Prop-driven, like the rail and the progress panel: `documents` arrives already
 * narrowed to where the user is standing. Scoping the list here as well would
 * make "the Source you are standing in" a rule written in three places, and the
 * hook is the one that holds the selection.
 *
 * `isRollUp` is the `All documents` view, and the only mode that prints a Source
 * name on each row — inside one Source the name would be the same word repeated
 * down the column.
 *
 * Deleting a Document is a hover-revealed trash with NO confirmation. That is
 * the light end of the page's deliberate asymmetry: one file, re-uploadable in
 * seconds. The heavy end is deleting a Source that still has Documents, which
 * demands its name typed out.
 */
export function DocumentsList({
  documents,
  isLoading,
  isRollUp,
  onDelete,
  isDeleting,
  onRequestUpload,
}: {
  documents: DocumentRow[];
  isLoading: boolean;
  isRollUp: boolean;
  onDelete: (dataSourceId: string, filename: string) => void;
  isDeleting: boolean;
  onRequestUpload?: () => void;
}) {
  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading documents…</p>;
  }

  if (documents.length === 0) {
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
      {documents.map((doc) => (
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
              {isRollUp ? `${doc.dataSourceName} · ` : null}
              {doc.count} chunks
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={isDeleting}
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => onDelete(doc.dataSourceId, doc.filename)}
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
