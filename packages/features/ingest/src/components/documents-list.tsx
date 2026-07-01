'use client';

import { Trash2 } from 'lucide-react';

import { Button } from '@acme/ui';

import { useDocuments } from '../hooks/use-documents';

export function DocumentsList() {
  const { documents, isLoading, deleteDocument, isDeleting } = useDocuments();

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading documents…</p>;
  }

  if (documents.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No documents uploaded yet.
      </p>
    );
  }

  return (
    <ul className="divide-border divide-y">
      {documents.map((doc) => (
        <li
          key={doc.filename}
          className="flex items-center justify-between py-2"
        >
          <div>
            <p className="text-sm font-medium">{doc.filename}</p>
            <p className="text-muted-foreground text-xs">{doc.count} chunks</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={isDeleting}
            onClick={() => deleteDocument(doc.filename)}
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Delete {doc.filename}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
