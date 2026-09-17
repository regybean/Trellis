'use client';

import { useState } from 'react';

import { headroomFor } from '../lib/data-source-validation';
import { useIngestUpload } from './ingest-upload-context';
import { useDataSources } from './use-data-sources';
import { useDocuments } from './use-documents';

/** A rail row: the Source, what it holds, and whether a batch is landing in it. */
export interface DataSourceSummary {
  id: string;
  name: string;
  documentCount: number;
  hasUploadInFlight: boolean;
}

const isTerminal = (stage: string) => stage === 'done' || stage === 'failed';

/**
 * The documents page's frontend contract: which Source the user is standing in,
 * the rail rows, and the advisory headroom every destination has.
 *
 * Three reads compose here rather than in the components. `dataSources.list`
 * gives the rows; the `documents.list` roll-up gives their counts, so the rail
 * costs no extra query per Source; and the shared upload state gives the
 * in-flight destinations, which is what lets the rail spin the row a batch is
 * landing in while the progress panel stays scoped to one Source.
 *
 * Selection is DERIVED against the live list, not stored as the answer. The
 * stored id is a request; the answer is whether a Source of that id still
 * exists. Deleting the Source you are standing in therefore lands you on `All
 * documents` with no effect to reconcile it, which is the whole reason it is
 * shaped this way — a `useEffect` clearing dangling state would paint one frame
 * of a Source that is gone.
 */
export function useDocumentsPage() {
  const {
    dataSources,
    isLoading,
    maxDataSourcesPerUser,
    maxDocumentsPerDataSource,
    createDataSource,
    isCreating,
    deleteDataSource,
    isDeleting,
  } = useDataSources();
  const { documents } = useDocuments();
  const { files } = useIngestUpload();
  const [requestedId, setRequestedId] = useState<string | null>(null);

  const documentCounts = new Map<string, number>();
  for (const doc of documents) {
    documentCounts.set(
      doc.dataSourceId,
      (documentCounts.get(doc.dataSourceId) ?? 0) + 1,
    );
  }

  const destinationsInFlight = new Set(
    files.filter((f) => !isTerminal(f.stage)).map((f) => f.dataSourceId),
  );

  const sources: DataSourceSummary[] = dataSources.map((source) => ({
    id: source.id,
    name: source.name,
    documentCount: documentCounts.get(source.id) ?? 0,
    hasUploadInFlight: destinationsInFlight.has(source.id),
  }));

  const selected = sources.find((source) => source.id === requestedId) ?? null;

  return {
    sources,
    isLoading,
    /** `null` is the `All documents` roll-up — not a Source, a place to stand. */
    selected,
    select: setRequestedId,
    totalDocumentCount: documents.length,
    maxDataSourcesPerUser,
    /**
     * Remaining Document slots in a Source, or `undefined` while the cap is in
     * flight. Advisory: shown when known, omitted when not, and never a gate on
     * the upload control — presign re-counts and rejects authoritatively.
     */
    headroom: (dataSourceId: string) =>
      headroomFor({
        documentCount: documentCounts.get(dataSourceId) ?? 0,
        cap: maxDocumentsPerDataSource,
      }),
    maxDocumentsPerDataSource,
    /**
     * Create and return the row, or `undefined` when the create failed — the
     * mutation has already toasted, and both inline-create sites need a plain
     * "did I get a Source" answer to decide whether to navigate.
     */
    createDataSource: async (name: string) => {
      try {
        return await createDataSource(name);
      } catch {
        return;
      }
    },
    isCreating,
    deleteDataSource,
    isDeleting,
  };
}
