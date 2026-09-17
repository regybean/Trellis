'use client';

import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

import { useDocumentUpload } from './use-document-upload';

// The upload dialog (which seeds progress via `upload()`), the progress panel
// above the list and the rail's per-row spinner all read ONE mount-owned
// progress state, and they sit in different DOM parents. A React context is the
// honest seam: they share the single `useDocumentUpload` instance the provider
// holds, wherever each one renders. The always-on progress subscription lives on
// that instance, so mounting the provider on the documents page is what makes
// the tail page-scoped.
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
