'use client';

import { useRef, useState } from 'react';

import { Button, Input } from '@acme/ui';

import { useIngestUpload } from '../hooks/ingest-upload-context';
import { useDataSources } from '../hooks/use-data-sources';

/**
 * Upload trigger plus its destination Data Source.
 *
 * An upload takes exactly one Source and it is mandatory, so the destination
 * has to be chosen before the file picker opens. With no Sources at all the
 * only possible destination is a new one, which is why the create field
 * replaces the select rather than sitting beside it — and why the placeholder
 * is a placeholder, never a prefill: a field pre-filled with "My Documents"
 * gets accepted unread.
 *
 * This is the plain interim of the destination picker. The documents-page
 * rework replaces it with the Source rail and the two-mode dialog, where the
 * destination is usually inherited from where you are standing rather than
 * selected.
 */
export function UploadDocumentsButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  // Shares the mount's upload state with `IngestProgress` via context, so a batch
  // triggered here streams into the panel above the list.
  const { upload, accept } = useIngestUpload();
  const { dataSources, createDataSource, isCreating } = useDataSources();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  // The destination: whatever was picked, else the only Source there is. The
  // preselect is safe in a way the chat-side default is not — upload targeting
  // is not the privacy boundary.
  const destination =
    selectedId ?? (dataSources.length === 1 ? dataSources[0]?.id : undefined);

  const handleFileChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(evt.target.files ?? [])];
    evt.target.value = ''; // allow re-uploading the same file
    if (!destination) return;
    void upload(files, destination);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    // Validate against the cached list first: a collision has to surface before
    // the optimistic row, never be absorbed into the Source of the same name.
    const collision = dataSources.some(
      (source) => source.name.toLowerCase() === name.toLowerCase(),
    );
    if (collision) return;
    const created = await createDataSource(name);
    setNewName('');
    setSelectedId(created.id);
  };

  if (dataSources.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <Input
          aria-label="New data source name"
          placeholder="e.g. Work notes"
          value={newName}
          onChange={(evt) => setNewName(evt.target.value)}
          className="w-48"
        />
        <Button onClick={() => void handleCreate()} disabled={isCreating}>
          Create data source
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Data source"
        className="border-input bg-background h-9 rounded-md border px-2 text-sm"
        value={destination ?? ''}
        onChange={(evt) => setSelectedId(evt.target.value)}
      >
        <option value="" disabled>
          Select a data source
        </option>
        {dataSources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </select>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        onChange={handleFileChange}
        className="hidden"
        id="documents-upload-input"
      />
      <Button
        onClick={() => inputRef.current?.click()}
        variant="default"
        disabled={!destination}
      >
        Upload Documents
      </Button>
    </div>
  );
}
