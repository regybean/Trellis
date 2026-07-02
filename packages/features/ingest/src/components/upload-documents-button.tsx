'use client';

import { useRef } from 'react';

import { Button } from '@acme/ui';

import { useDocumentUpload } from '../hooks/use-document-upload';

export function UploadDocumentsButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, status, accept } = useDocumentUpload();
  const isUploading = status === 'uploading';

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
      <Button
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        variant="default"
      >
        {isUploading ? 'Uploading...' : 'Upload Documents'}
      </Button>
    </>
  );
}
