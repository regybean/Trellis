'use client';

import { revalidateLogic, useForm, useSelector } from '@tanstack/react-form';
import { z } from 'zod';

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
 *
 * `source` is the LIVE row, resolved by the page against the list on every
 * render, and this component is mounted only while one is pending. So the count
 * in the copy tracks `documents.list` while the dialog sits open instead of
 * being frozen at the moment the trash was clicked, and a Source that
 * disappears from under the dialog takes the dialog with it.
 */
export function DeleteDataSourceDialog({
  source,
  onConfirm,
  onClose,
  isDeleting,
}: {
  /** The Source under the knife. Live, not a snapshot taken at open-time. */
  source: DataSourceSummary;
  onConfirm: (id: string) => void;
  onClose: () => void;
  isDeleting: boolean;
}) {
  // Exact match, trimmed. Case-folding here would undercut the point: the
  // friction IS reading the name off the dialog and reproducing it. One
  // predicate, two readers — the schema that guards the submit and the button
  // that stays dead until it passes.
  const matchesName = (typed: string) => typed.trim() === source.name;

  const form = useForm({
    defaultValues: { typed: '' },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        typed: z.string().refine(matchesName, 'Type the name to confirm.'),
      }),
    },
    onSubmit: () => {
      onConfirm(source.id);
      onClose();
    },
  });

  // The confirm button is dead until the name matches, so the field has to be
  // read live rather than only at submit.
  const typed = useSelector(form.store, (state) => state.values.typed);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form
          onSubmit={(evt) => {
            evt.preventDefault();
            void form.handleSubmit();
          }}
          noValidate
        >
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{source.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This deletes {source.documentCount}{' '}
              {source.documentCount === 1 ? 'document' : 'documents'} and
              everything indexed from them. The assistant will no longer be able
              to answer questions about this data source. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5 py-4">
            <Label htmlFor="confirm-data-source-name">
              Type {source.name} to confirm
            </Label>
            <form.Field name="typed">
              {(field) => (
                <Input
                  id="confirm-data-source-name"
                  aria-label="Confirm data source name"
                  value={field.state.value}
                  autoComplete="off"
                  onChange={(evt) => field.handleChange(evt.target.value)}
                />
              )}
            </form.Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!matchesName(typed) || isDeleting}
            >
              Delete data source
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
