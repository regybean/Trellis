'use client';

import { useState } from 'react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@acme/ui';

import type { DataSourceSummary } from '../hooks/use-documents-page';

/**
 * The heavy end of the page's delete asymmetry: a type-the-name confirm for a
 * Data Source that still holds Documents.
 *
 * Friction tracks consequence, and that is the rule rather than a nicety. A
 * Document is one file, re-uploadable in seconds, so it deletes from a hover
 * trash with no confirm. A Source with Documents takes every one of them plus
 * everything indexed from them, across a database boundary, with no undo — so
 * the copy quotes the name, states the exact count, and says the index goes
 * too, and the button stays dead until the name is typed out.
 *
 * A Source with ZERO Documents never reaches this dialog: the page deletes it
 * immediately, with no confirmation at all. Confirming the deletion of an empty
 * container is the kind of prompt that teaches users to click through prompts.
 */
export function DeleteDataSourceDialog({
  source,
  onOpenChange,
  onConfirm,
  isDeleting,
}: {
  /** The Source under the knife, or `null` when the dialog is closed. */
  source: DataSourceSummary | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string) => void;
  isDeleting: boolean;
}) {
  const [typed, setTyped] = useState('');

  const close = () => {
    setTyped('');
    onOpenChange(false);
  };

  // Exact match, trimmed. Case-folding here would undercut the point: the
  // friction IS reading the name off the dialog and reproducing it.
  const matches = source !== null && typed.trim() === source.name;

  return (
    <Dialog
      open={source !== null}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{source?.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            This deletes {source?.documentCount}{' '}
            {source?.documentCount === 1 ? 'document' : 'documents'} and
            everything indexed from them. The assistant will no longer be able
            to answer questions about this data source. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-data-source-name">
            Type {source?.name} to confirm
          </Label>
          <Input
            id="confirm-data-source-name"
            aria-label="Confirm data source name"
            value={typed}
            autoComplete="off"
            onChange={(evt) => setTyped(evt.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || isDeleting}
            onClick={() => {
              if (!source) return;
              onConfirm(source.id);
              close();
            }}
          >
            Delete data source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
