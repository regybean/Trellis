'use client';

import { useRef } from 'react';

import { Button } from '@acme/ui';

import { useIngestUpload } from '../hooks/ingest-upload-context';

export function UploadDocumentsButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  // Shares the mount's upload state with `IngestProgress` via context, so a batch
  // triggered here streams into the panel above the list.
  const { upload, accept } = useIngestUpload();

  const handleFileChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(evt.target.files ?? [])];
    evt.target.value = ''; // allow re-uploading the same file
    void upload(files);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        onChange={handleFileChange}
        className="hidden"
        id="documents-upload-input"
      />
      <Button onClick={() => inputRef.current?.click()} variant="default">
        Upload Documents
      </Button>
    </>
  );
}
