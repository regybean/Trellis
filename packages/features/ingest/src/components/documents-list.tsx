'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { toast } from 'react-toastify';

import { Button } from '@acme/ui';

import { useTRPC } from '../trpc/react';

export function DocumentsList() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: documents = [], isLoading } = useQuery(
    trpc.documents.list.queryOptions(),
  );

  const deleteDocument = useMutation(
    trpc.documents.delete.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.documents.list.pathFilter());
        toast.success('Document deleted');
      },
      onError: () => toast.error('Failed to delete document'),
    }),
  );

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
            disabled={deleteDocument.isPending}
            onClick={() => deleteDocument.mutate({ filename: doc.filename })}
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Delete {doc.filename}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
