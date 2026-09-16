/**
 * Fixture cleanup for @acme/rag's backend suite.
 *
 * Deliberately `cleanup.ts` and not `test-context.ts`: rag has no router and no
 * caller to build, so the conventional name would imply a seam this package does
 * not have. All this file does is undo what a test created.
 *
 * Owner-scoped rather than wholesale. A test mints a random owner id and clears
 * it, so nothing here depends on suite sequencing or on being the only file
 * touching the schema — and a stray assertion can never be green because some
 * other file's rows were truncated out from under it.
 *
 * Chunks before rows, the same order production deletes in, so the util cannot
 * leave the orphaned-chunk state that ordering exists to avoid.
 */

import { eq, inArray, sql } from 'drizzle-orm';

import { createDb } from '@acme/db';

import { env } from '../../../env';
import { dataSource } from '../../../schemas/data-source-schema';
import { documents } from '../../../schemas/documents-schema';
import { ensureVectorIndex } from '../../../vector';

const db = createDb();
const vdb = createDb({ database: env.DB_VECTOR_NAME });

/**
 * Delete every Data Source belonging to these owners, and every knowledge-base
 * chunk stamped with them. A no-op for an owner that created nothing.
 *
 * The `ensureVectorIndex` call is why this is a helper rather than two inline
 * deletes: Mastra creates `mastra_documents` lazily, so a test file that never
 * uploads anything would otherwise fail its own teardown on a missing relation.
 */
export async function cleanupDataSources(ownerIds: string[]) {
  if (ownerIds.length === 0) return;

  await ensureVectorIndex();

  await vdb
    .delete(documents)
    .where(inArray(sql`(${documents.metadata} ->> 'owner_id')`, ownerIds));

  for (const ownerId of ownerIds) {
    await db.delete(dataSource).where(eq(dataSource.ownerId, ownerId));
  }
}
