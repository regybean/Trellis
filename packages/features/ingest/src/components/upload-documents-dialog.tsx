'use client';

import { useState } from 'react';
import { toast } from 'react-toastify';

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@acme/ui';

import type { DataSourceSummary } from '../hooks/use-documents-page';
import { useIngestUpload } from '../hooks/ingest-upload-context';
import {
  collisionMessage,
  findNameCollision,
} from '../lib/data-source-validation';

// The sentinel `Select` value for `＋ New data source…`. A reserved value rather
// than a second control, because the create option has to be the LAST item in
// the same popup — a separate "or create one" button beside the select is the
// shape that makes users open a second modal to find it.
const CREATE_OPTION = '__create__';

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
 * With zero Sources the select disappears entirely rather than rendering empty,
 * because a new Source is then the only possible destination and a select with
 * one create option in it is a select pretending to be a button.
 *
 * Upload takes exactly ONE Source and it is mandatory, which is the opposite of
 * chat's selection (zero or more, defaulting to zero). So: preselect when the
 * user has exactly one Source, and require an explicit pick at two or more. The
 * preselect is safe here in a way a chat-side default would not be — upload
 * targeting is not the privacy boundary.
 */
export function UploadDocumentsDialog({
  open,
  onOpenChange,
  destination,
  sources,
  headroom,
  atSourceCap,
  onCreateDataSource,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destination: DataSourceSummary | null;
  sources: DataSourceSummary[];
  headroom: (dataSourceId: string) => number | undefined;
  atSourceCap: boolean;
  onCreateDataSource: (name: string) => Promise<{ id: string } | undefined>;
  onUploaded: (dataSourceId: string) => void;
}) {
  const { upload, accept } = useIngestUpload();
  const [files, setFiles] = useState<File[]>([]);
  // `null` = nothing picked yet. With zero Sources there is nothing to pick, so
  // the inline name field is the only destination and this stays null.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [destinationError, setDestinationError] = useState<string | null>(null);

  const inheritsDestination = destination !== null;
  const hasSources = sources.length > 0;
  // Zero Sources means inline create is the only path, so the field is shown
  // without anyone having asked for it.
  const isCreatingInline =
    !inheritsDestination && (!hasSources || pickedId === CREATE_OPTION);

  const onlySource = sources.length === 1 ? sources[0] : undefined;
  const selectValue = pickedId ?? onlySource?.id ?? '';

  const reset = () => {
    setFiles([]);
    setPickedId(null);
    setName('');
    setNameError(null);
    setDestinationError(null);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  // The advisory slot count for wherever the files are headed. Omitted while the
  // cap is in flight, and absent for a brand-new Source, which is empty by
  // definition.
  const shownHeadroom =
    destination?.id ?? (pickedId && pickedId !== CREATE_OPTION ? pickedId : '');
  const slotsLeft = shownHeadroom ? headroom(shownHeadroom) : undefined;

  /** The destination id, creating the Source first when that is the mode. */
  const resolveDestination = async () => {
    if (destination) return destination.id;

    if (isCreatingInline) {
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        setNameError('Name your data source.');
        return;
      }
      // Reject, never absorb — checked against the cached list before the
      // mutation, so a collision costs no optimistic row and no presign call.
      const clash = findNameCollision(sources, trimmed);
      if (clash) {
        setNameError(collisionMessage(clash.name));
        return;
      }
      const created = await onCreateDataSource(trimmed);
      return created?.id;
    }

    const picked = pickedId ?? onlySource?.id;
    if (!picked) {
      setDestinationError('Choose a data source.');
      return;
    }
    return picked;
  };

  const submit = async () => {
    if (files.length === 0) {
      setDestinationError(null);
      toast.error('Choose at least one file to upload.');
      return;
    }

    const dataSourceId = await resolveDestination();
    if (!dataSourceId) return;

    // Advisory again: refuse the whole batch rather than admitting the files
    // that fit, matching what presign does authoritatively — partial admission
    // would leave the user reconciling which of their files made it.
    const slots = headroom(dataSourceId);
    if (slots !== undefined && files.length > slots) {
      const plural = slots === 1 ? '' : 's';
      toast.error(
        slots === 0
          ? 'That data source is full.'
          : `That data source has room for ${slots} more document${plural}.`,
      );
      return;
    }

    // Land where the files went, before the upload starts — so the scoped
    // progress panel is already on screen for the batch it belongs to.
    onUploaded(dataSourceId);
    void upload(files, dataSourceId);
    close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {destination ? `Upload to ${destination.name}` : 'Upload documents'}
          </DialogTitle>
          <DialogDescription>
            {destination
              ? 'PDF, DOCX and TXT files are indexed so the assistant can answer questions about them.'
              : 'Files land in exactly one data source. Choose where these go.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="documents-upload-input">Files</Label>
            <Input
              id="documents-upload-input"
              type="file"
              multiple
              accept={accept}
              onChange={(evt) => setFiles([...(evt.target.files ?? [])])}
            />
          </div>

          {!inheritsDestination && hasSources && (
            <div className="space-y-1.5">
              <Label htmlFor="upload-data-source">Data source</Label>
              <Select
                value={selectValue}
                onValueChange={(value) => {
                  setPickedId(value);
                  setDestinationError(null);
                  setNameError(null);
                }}
              >
                <SelectTrigger id="upload-data-source" aria-label="Data source">
                  <SelectValue placeholder="Select a data source" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.name}
                    </SelectItem>
                  ))}
                  {/* Last, always — the create path is the exception, not a peer
                      of the Sources above it. Disabled at the cap for the same
                      reason the rail's row is. */}
                  <SelectItem value={CREATE_OPTION} disabled={atSourceCap}>
                    ＋ New data source…
                  </SelectItem>
                </SelectContent>
              </Select>
              {destinationError && (
                <p role="alert" className="text-destructive text-xs">
                  {destinationError}
                </p>
              )}
            </div>
          )}

          {isCreatingInline && (
            <div className="space-y-1.5">
              <Label htmlFor="upload-new-data-source">New data source</Label>
              <Input
                id="upload-new-data-source"
                aria-label="New data source name"
                // Placeholder, never a prefill.
                placeholder="e.g. Work notes"
                value={name}
                onChange={(evt) => {
                  setName(evt.target.value);
                  setNameError(null);
                }}
              />
              {nameError && (
                <p role="alert" className="text-destructive text-xs">
                  {nameError}
                </p>
              )}
            </div>
          )}

          {slotsLeft !== undefined && (
            <p className="text-muted-foreground text-xs">
              {slotsLeft} slot{slotsLeft === 1 ? '' : 's'} left
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          {/* Deliberately NOT disabled on headroom: presign is the authority,
              and a disabled control would make an advisory count a gate. */}
          <Button onClick={() => void submit()}>Upload</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
