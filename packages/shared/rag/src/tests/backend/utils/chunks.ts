/**
 * Read the knowledge-base mirror directly, for assertions only.
 *
 * Seeding never comes through here — it goes through `uploadDoc` and
 * `createDataSource`, because a fixture with more power than production can lie
 * in both directions: passing on a state that cannot occur, or failing on one
 * that cannot either. This file is the OBSERVER half, and a raw read is exactly
 * what some of the assertions need:
 *
 *   - "pgvector is unchanged" after a rejected upload is a negative, and a
 *     production read scoped to the Source would return nothing whether the
 *     upsert was skipped or merely unreachable.
 *   - "A2's and B1's chunks are untouched" after a cascade has to see across the
 *     owner boundary the production filter exists to stop it crossing.
 *
 * Exclusion itself is NOT asserted through this file. That claim goes through
 * `resolveRetrievalScope` and a real vector query — see
 * `integration/service/retrieval-scope.test.ts`.
 */

import { asc, eq } from 'drizzle-orm';

import { createDb } from '@acme/db';

import { env } from '../../../env';
import {
  documents,
  metadataField,
  SCOPE_KEYS,
} from '../../../schemas/documents-schema';

const vdb = createDb({ database: env.DB_VECTOR_NAME });

export interface StoredChunk {
  vectorId: string;
  fileName: string;
  dataSourceId: string;
}

/** Every chunk stamped with this owner, oldest row first. */
export function chunksOwnedBy(ownerId: string): Promise<StoredChunk[]> {
  return vdb
    .select({
      vectorId: documents.vectorId,
      fileName: metadataField('file_name'),
      dataSourceId: metadataField(SCOPE_KEYS.data_source_id),
    })
    .from(documents)
    .where(eq(metadataField(SCOPE_KEYS.owner_id), ownerId))
    .orderBy(asc(documents.id));
}

/** Every chunk stamped with this Data Source, oldest row first. */
export function chunksIn(dataSourceId: string): Promise<StoredChunk[]> {
  return vdb
    .select({
      vectorId: documents.vectorId,
      fileName: metadataField('file_name'),
      dataSourceId: metadataField(SCOPE_KEYS.data_source_id),
    })
    .from(documents)
    .where(eq(metadataField(SCOPE_KEYS.data_source_id), dataSourceId))
    .orderBy(asc(documents.id));
}
