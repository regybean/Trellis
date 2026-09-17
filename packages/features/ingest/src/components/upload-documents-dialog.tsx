'use client';

import { revalidateLogic, useForm, useSelector } from '@tanstack/react-form';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  firstErrorMessage,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@acme/ui';

import type { DataSourceSummary } from '../hooks/use-documents-page';
import { useIngestUpload } from '../hooks/ingest-upload-context';
import {
  CREATE_DATA_SOURCE_OPTION,
  uploadDestinationMode,
  uploadDocumentsSchema,
  uploadSlots,
} from '../lib/upload-destination';

/**
 * One upload dialog, two modes, and never a modal inside a modal.
 *
 * `destination` is the Source the user is standing in. When it is set the
 * destination is INHERITED: the dialog is titled `Upload to <name>` and offers
 * no destination control at all, because choosing one again would ask the user
 * to re-answer a question the page already answers by where they are standing.
 *
 * When it is null the user is in `All documents`, which is not a place files can
 * land, so the dialog is files-first with a `Data source` select in the same
 * popup. `＋ New data source…` is its last option and swaps the select for an
 * inline name field — the one thing it must not do is open a second dialog.
 *
 * Which of those three questions is open, and every rule that follows from the
 * answer, is `lib/upload-destination.ts`. This component renders the controls
 * for the mode and nothing more: no check is sequenced here, and every rejection
 * lands on the field that caused it.
 *
 * Upload takes exactly ONE Source and it is mandatory, which is the opposite of
 * chat's selection (zero or more, defaulting to zero). So: preselect when the
 * user has exactly one Source, and require an explicit pick at two or more. The
 * preselect is safe here in a way a chat-side default would not be — upload
 * targeting is not the privacy boundary.
 *
 * Mounted only while open (the page drops it on close), so every field starts
 * from `defaultValues` and there is no reset to remember. That is also what lets
 * the single-Source preselect BE the field's value rather than a fallback
 * re-derived at each read — the earlier shape left the headroom line reading an
 * empty slot, so "N slots left" never appeared for a user with one Source until
 * they re-picked the Source they already had.
 */
export function UploadDocumentsDialog({
  destination,
  sources,
  headroom,
  maxDocumentsPerDataSource,
  atSourceCap,
  onCreateDataSource,
  onUploaded,
  onClose,
}: {
  destination: DataSourceSummary | null;
  sources: DataSourceSummary[];
  headroom: (dataSourceId: string) => number | undefined;
  maxDocumentsPerDataSource: number | undefined;
  atSourceCap: boolean;
  onCreateDataSource: (name: string) => Promise<{ id: string } | undefined>;
  onUploaded: (dataSourceId: string) => void;
  onClose: () => void;
}) {
  const { upload, accept } = useIngestUpload();

  const inheritsDestination = destination !== null;
  const hasSources = sources.length > 0;
  const onlySource = sources.length === 1 ? sources[0] : undefined;

  /**
   * The destination id, creating the Source first when that is the mode. Reads
   * the mode off the submitted values rather than the rendered one, so it is
   * the values that were validated that decide.
   */
  const resolveDestination = async (value: {
    dataSourceId: string;
    name: string;
  }) => {
    if (destination) return destination.id;
    const submitted = uploadDestinationMode({
      inheritsDestination,
      hasSources,
      dataSourceId: value.dataSourceId,
    });
    // Create LAST, and only for a name validation has already accepted — so a
    // collision costs no Source, no optimistic row and no presign call.
    if (submitted === 'create') {
      const created = await onCreateDataSource(value.name.trim());
      return created?.id;
    }
    return value.dataSourceId;
  };

  const form = useForm({
    defaultValues: {
      files: [] as File[],
      // The preselect, as a real value: with exactly one Source, that Source is
      // already the answer.
      dataSourceId: inheritsDestination ? '' : (onlySource?.id ?? ''),
      name: '',
    },
    // Validate on submit, then on every change after the first attempt — so the
    // dialog never scolds the user about a field they have not reached yet, and
    // a rejection clears itself as they fix it.
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: uploadDocumentsSchema({
        inheritsDestination,
        destinationId: destination?.id,
        sources,
        headroom,
        maxDocumentsPerDataSource,
      }),
    },
    onSubmit: async ({ value }) => {
      const dataSourceId = await resolveDestination(value);
      if (!dataSourceId) return;

      // Land where the files went, before the upload starts — so the scoped
      // progress panel is already on screen for the batch it belongs to.
      onUploaded(dataSourceId);
      void upload(value.files, dataSourceId);
      onClose();
    },
  });

  // Read reactively: the picked destination decides which control renders and
  // which slot count is shown beneath them.
  const dataSourceId = useSelector(
    form.store,
    (state) => state.values.dataSourceId,
  );

  const mode = uploadDestinationMode({
    inheritsDestination,
    hasSources,
    dataSourceId,
  });
  const slots = uploadSlots({
    mode,
    destinationId: destination?.id,
    dataSourceId,
    headroom,
    maxDocumentsPerDataSource,
  });

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
            <DialogTitle>
              {destination
                ? `Upload to ${destination.name}`
                : 'Upload documents'}
            </DialogTitle>
            <DialogDescription>
              {destination
                ? 'PDF, DOCX and TXT files are indexed so the assistant can answer questions about them.'
                : 'Files land in exactly one data source. Choose where these go.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <form.Field name="files">
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor="documents-upload-input">Files</Label>
                  <Input
                    id="documents-upload-input"
                    type="file"
                    multiple
                    accept={accept}
                    onChange={(evt) =>
                      field.handleChange([...(evt.target.files ?? [])])
                    }
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>

            {mode !== 'inherited' && hasSources && (
              <form.Field name="dataSourceId">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label htmlFor="upload-data-source">Data source</Label>
                    <Select
                      value={field.state.value}
                      onValueChange={(value) => field.handleChange(value)}
                    >
                      <SelectTrigger
                        id="upload-data-source"
                        aria-label="Data source"
                      >
                        <SelectValue placeholder="Select a data source" />
                      </SelectTrigger>
                      <SelectContent>
                        {sources.map((source) => (
                          <SelectItem key={source.id} value={source.id}>
                            {source.name}
                          </SelectItem>
                        ))}
                        {/* Last, always — the create path is the exception, not
                            a peer of the Sources above it. Disabled at the cap
                            for the same reason the rail's row is. */}
                        <SelectItem
                          value={CREATE_DATA_SOURCE_OPTION}
                          disabled={atSourceCap}
                        >
                          ＋ New data source…
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldError errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>
            )}

            {mode === 'create' && (
              <form.Field name="name">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label htmlFor="upload-new-data-source">
                      New data source
                    </Label>
                    <Input
                      id="upload-new-data-source"
                      aria-label="New data source name"
                      // Placeholder, never a prefill.
                      placeholder="e.g. Work notes"
                      value={field.state.value}
                      onChange={(evt) => field.handleChange(evt.target.value)}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>
            )}

            {/* Omitted in create mode: a Source that does not exist yet has its
                whole cap free, and "50 slots left" beside an empty name field
                reads as a fact about a Source the user cannot see. */}
            {mode !== 'create' && slots !== undefined && (
              <p className="text-muted-foreground text-xs">
                {slots} slot{slots === 1 ? '' : 's'} left
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {/* Deliberately NOT disabled on headroom: presign is the authority,
                and a disabled control would make an advisory count a gate. */}
            <Button type="submit">Upload</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A field's rejection, beside the field. Every one of them renders here — a
 * toast for a form error puts the message somewhere other than the control that
 * caused it, which is what this dialog used to do for two of the four.
 */
function FieldError({ errors }: { errors: readonly unknown[] }) {
  const message = firstErrorMessage(errors);
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-xs">
      {message}
    </p>
  );
}
