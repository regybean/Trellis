'use client';

import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

import { useDocumentUpload } from './use-document-upload';

// The upload trigger (`UploadDocumentsButton`, in the section header) and the
// live progress panel (`IngestProgress`, above the list) sit in different DOM
// parents but must share ONE mount-owned progress state: the button seeds it via
// `upload()`, the panel renders it. A React context is the honest seam — the app
// composes WHERE each piece renders (chrome is app-owned), while they share the
// single `useDocumentUpload` instance the provider holds. The always-on progress
// subscription lives on that instance, so mounting the provider on the documents
// section is what makes the tail page-scoped.
const IngestUploadContext = createContext<ReturnType<
  typeof useDocumentUpload
> | null>(null);

export function IngestUploadProvider({ children }: { children: ReactNode }) {
  const value = useDocumentUpload();
  return (
    <IngestUploadContext.Provider value={value}>
      {children}
    </IngestUploadContext.Provider>
  );
}

export function useIngestUpload() {
  const context = useContext(IngestUploadContext);
  if (!context) {
    throw new Error(
      'useIngestUpload must be used within <IngestUploadProvider>',
    );
  }
  return context;
}
