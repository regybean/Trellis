import { RequestContext } from '@mastra/core/request-context';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { createDb } from '@acme/db';
import { logger } from '@acme/logger';

import { env } from './env';
import {
  dataSource,
  DataSourceName,
  selectDataSourceSchema,
} from './schemas/data-source-schema';
import {
  documents,
  metadataField,
  SCOPE_KEYS,
} from './schemas/documents-schema';
import { ensureVectorIndex } from './vector';

/**
 * The Data Source module: every read and write of `data_source`, the ownership
 * rule, and the one function that builds a trusted retrieval context.
 *
 * ONE module, not several, and no client exported from it. Splitting ownership,
 * filter-building and CRUD across three files means either each constructs its
 * own db client or one exports the client to the others — and an exported client
 * bypasses the ownership predicate. Same instinct as `nsKey`: make the wrong
 * thing unavailable rather than discouraged. Reached only through `./server`,
 * which carries `import 'server-only'`, so "access goes through this module" is
 * a build-time failure rather than a convention.
 *
 * This module is transport-free. `DataSourceOwnershipError` is mapped onto tRPC
 * in exactly one place, `./ownership-trpc`, beside the same seam for thread
 * ownership.
 */

// Drizzle client against the APP database, module-private. Mirrors the `vdb`
// precedent in `document-uploader.ts`: the table export in `./schema` exists for
// drizzle-kit's benefit, not for feature code to query.
const db = createDb();

// Drizzle client against the VECTOR database, module-private. The cascade needs
// it because a Source's chunks live there, in a database this module does not
// otherwise touch. Reusing `document-uploader.ts`'s client would mean exporting
// it, which is the thing this module exists to prevent.
const vdb = createDb({ database: env.DB_VECTOR_NAME });

/**
 * The caller asked for a Data Source that is not theirs — or no longer exists.
 * The two are indistinguishable on purpose: rows are hard-deleted, so "was
 * yours, now deleted" and "never was yours" are both simply absent, and one
 * policy has to cover both.
 */
export class DataSourceOwnershipError extends Error {
  readonly dataSourceIds: string[];
  constructor(dataSourceIds: string[]) {
    super(
      `Data source(s) ${dataSourceIds.join(', ')} are not owned by this user`,
    );
    this.name = 'DataSourceOwnershipError';
    this.dataSourceIds = dataSourceIds;
  }
}

/** The owner is at `MAX_DATA_SOURCES_PER_USER` and cannot create another. */
export class DataSourceQuotaError extends Error {
  readonly cap: number;
  constructor(cap: number) {
    super(`Data source limit of ${cap} reached`);
    this.name = 'DataSourceQuotaError';
    this.cap = cap;
  }
}

/**
 * The shape of the trusted retrieval context, owned HERE rather than in
 * `@acme/chat` where `new Agent()` lives. Declaring it beside `new Agent()`
 * would express the filter's shape twice, and the divergence that produces
 * fails toward an unvalidated filter. Chat's
 * `requestContextSchema: retrievalContextSchema` is one wiring line with no
 * domain knowledge in it.
 *
 * Mastra validates this at the start of `stream`/`generate`, before any LLM
 * call. That converts the framework's worst fail-open hole into a loud crash:
 * passing no request context validates `{}`, so a REQUIRED `filter` throws
 * rather than silently retrieving over the whole corpus.
 *
 * `topK` is required, not optional, for the same reason. A misspelled or
 * refactored-away key is stripped silently, `requestContext.get('topK')` returns
 * undefined, and retrieval reverts to an LLM-authored `topK` with no error —
 * exactly the class of silent failure this schema exists to convert into a
 * throw.
 *
 * A stated limit on the guarantee: this is validated on the Agent's
 * `stream`/`generate` path only. Mastra workflow steps have separate handling
 * behind a `validateInputs` flag the Agent path lacks. Today there is one
 * `stream` call and no workflows, so it does not bite — but if anything ever
 * wraps the chat agent in a workflow, this backstop's coverage must be
 * rechecked.
 */
export const retrievalContextSchema = z.object({
  // Keyed through `SCOPE_KEYS`, so the validator, the writer's stamp and the
  // filter below cannot drift apart: renaming a metadata key is a compile error
  // in all three rather than a silent total retrieval failure.
  filter: z.object({
    [SCOPE_KEYS.owner_id]: z.string().min(1),
    [SCOPE_KEYS.data_source_id]: z.object({ $in: z.array(z.uuid()) }),
  }),
  topK: z.number().int().positive(),
});

type RetrievalContextValues = z.infer<typeof retrievalContextSchema>;

export interface DataSourceScope {
  ownerId: string;
  dataSourceIds: string[];
}

/**
 * The retrieval filter, and the reason this function is not exported.
 *
 * It is always two clauses. `owner_id` is the privacy boundary; `data_source_id`
 * is scope selection. There is no `OR global` branch, because there is no global
 * corpus, and `{}` is unconstructible through this module's public surface —
 * which matters because Mastra's tool treats an empty-object filter as "enable
 * filtering, then drop the empty filter", running unfiltered on the fast path.
 *
 * "Retrieve nothing" is `{ $in: [] }`, the ordinary expression of the empty set,
 * built on the same unbranched path as everything else. `resolveRetrievalScope`
 * reports emptiness separately so the caller can skip the round trip, but the
 * filter itself stays unbranched: if that optimisation is ever dropped, this is
 * what still fails closed.
 */
function buildDataSourceFilter({
  ownerId,
  dataSourceIds,
}: DataSourceScope): RetrievalContextValues['filter'] {
  return {
    [SCOPE_KEYS.owner_id]: ownerId,
    [SCOPE_KEYS.data_source_id]: { $in: dataSourceIds },
  };
}

/**
 * The ownership rule. Takes ids raw and throws `DataSourceOwnershipError` naming
 * the ones that are not the caller's. An empty request is trivially owned and
 * costs no query.
 *
 * Called at every point of use rather than once at the edge. A brand proving a
 * caller had already validated would die at BullMQ's JSON boundary anyway, and
 * re-asserting costs one indexed read against a table capped at ten rows per
 * user — which buys the delete-while-in-flight case for free, because a Source
 * deleted mid-flight simply is not in scope.
 */
export async function assertDataSourceOwned({
  ownerId,
  dataSourceIds,
}: DataSourceScope) {
  const requested = [...new Set(dataSourceIds)];
  if (requested.length === 0) return;

  const owned = await db
    .select({ id: dataSource.id })
    .from(dataSource)
    .where(
      and(eq(dataSource.ownerId, ownerId), inArray(dataSource.id, requested)),
    );

  if (owned.length === requested.length) return;

  const ownedIds = new Set(owned.map((row) => row.id));
  throw new DataSourceOwnershipError(
    requested.filter((id) => !ownedIds.has(id)),
  );
}

/**
 * Resolve a caller's Source selection into a trusted retrieval context.
 *
 * Asserts ownership ITSELF, before building anything, so no code path can reach
 * a filter that skipped validation. That is the whole point of the function: it
 * takes ids raw precisely so there is no "already validated" variant of the
 * input to trust.
 *
 * It returns the whole `RequestContext`, never a bare filter, because `filter`
 * is not the only knob the request context overrides — `indexName`,
 * `vectorStoreName`, `model`, `topK`, `reranker`, `databaseConfig` and
 * `includeSources` all are. A context naming the right owner and the wrong
 * `indexName` leaks as surely as a missing filter, so the trusted object is
 * assembled inside the module that owns the trust rule.
 *
 * `hasSources` is the one addition to that otherwise opaque return. Whether
 * there is anything to retrieve is a fact the caller cannot legally recompute
 * from its own raw input: a Source deleted since the selection was made is
 * rejected here, so a caller counting its raw array would attach a retrieval
 * tool to a Turn that can retrieve nothing.
 */
export async function resolveRetrievalScope({
  ownerId,
  dataSourceIds,
}: DataSourceScope) {
  await assertDataSourceOwned({ ownerId, dataSourceIds });

  const requestContext = new RequestContext<RetrievalContextValues>([
    ['filter', buildDataSourceFilter({ ownerId, dataSourceIds })],
    ['topK', env.RETRIEVAL_TOP_K],
  ]);

  return { requestContext, hasSources: dataSourceIds.length > 0 };
}

/** A caller's own Data Sources, oldest first. */
export async function listDataSources({ ownerId }: { ownerId: string }) {
  const rows = await db
    .select()
    .from(dataSource)
    .where(eq(dataSource.ownerId, ownerId))
    .orderBy(asc(dataSource.createdAt));

  return rows.map((row) => selectDataSourceSchema.parse(row));
}

/**
 * Create a Data Source, enforcing `MAX_DATA_SOURCES_PER_USER` here so every
 * router that wires this inherits the cap rather than re-implementing it (both
 * `@acme/ingest` and `@acme/chat` expose a create procedure over this one
 * function).
 *
 * The name goes through `DataSourceName` rather than trusting the caller to have
 * parsed it, because trimming is part of the uniqueness rule: the index
 * case-folds but does not trim, so "Work" and " Work" would both be storable if
 * any caller skipped it.
 *
 * Count-then-insert is not serialised. Two creates racing at the cap can both
 * pass and leave an owner with one Source too many, which is benign — it is a
 * quota, not the privacy boundary, and the failure is a slightly long picker
 * rather than a leak. A name collision is NOT handled here: the unique index
 * raises it, deliberately, because the client validates against its cached list
 * first and this constraint is only the race backstop. Absorbing a collision
 * into the existing Source is the one thing that must not happen — the user
 * believes they created a fresh, unselected Source while their documents land in
 * one that may already be ticked in an open conversation.
 */
export async function createDataSource({
  ownerId,
  id,
  name,
}: {
  ownerId: string;
  id: string;
  name: string;
}) {
  const [existing] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(dataSource)
    .where(eq(dataSource.ownerId, ownerId));

  if ((existing?.count ?? 0) >= env.MAX_DATA_SOURCES_PER_USER) {
    throw new DataSourceQuotaError(env.MAX_DATA_SOURCES_PER_USER);
  }

  const [created] = await db
    .insert(dataSource)
    .values({ id, ownerId, name: DataSourceName.parse(name) })
    .returning();

  if (!created) {
    throw new Error(`Failed to create data source ${id}`);
  }

  logger.info({ ownerId, dataSourceId: created.id }, 'data source created');
  return selectDataSourceSchema.parse(created);
}

/**
 * Rename a Data Source. The owner-scoped `WHERE` doubles as the ownership
 * assert — no row updated means the Source is not the caller's (or is gone), so
 * there is no separate read to keep in step with it. A rename touches zero
 * vector rows: identity is the id, and no chunk carries the name.
 */
export async function renameDataSource({
  ownerId,
  id,
  name,
}: {
  ownerId: string;
  id: string;
  name: string;
}) {
  const [updated] = await db
    .update(dataSource)
    .set({ name: DataSourceName.parse(name), updatedAt: new Date() })
    .where(and(eq(dataSource.id, id), eq(dataSource.ownerId, ownerId)))
    .returning();

  if (!updated) throw new DataSourceOwnershipError([id]);

  logger.info({ ownerId, dataSourceId: id }, 'data source renamed');
  return selectDataSourceSchema.parse(updated);
}

/**
 * Delete a Data Source and every chunk in it: **chunks before the row**,
 * non-atomic by necessity.
 *
 * The two tables live in different databases (`data_source` in the app database,
 * `mastra_documents` in the dedicated vector one), so this can be neither a
 * foreign key nor a transaction. It is two writes that can partially fail, and
 * the ordering follows from comparing the interrupted states. Chunks first
 * leaves the row surviving with fewer Documents: visible, honest, and
 * idempotently retryable, since hitting delete again finishes the job. Row first
 * would leave chunks whose `data_source_id` resolves to nothing — unreachable,
 * so fail-closed, but permanent invisible ballast that nothing can delete and
 * nothing can reach.
 *
 * The chunk delete carries `owner_id` as well as `data_source_id`. It is the
 * mirror image of the retrieval filter, and worse if it is too broad, because
 * this one is destructive and unrecoverable.
 */
export async function deleteDataSource({
  ownerId,
  id,
}: {
  ownerId: string;
  id: string;
}) {
  await assertDataSourceOwned({ ownerId, dataSourceIds: [id] });

  // Mastra creates `mastra_documents` lazily, and the app provisions it at boot
  // — but a delete must not depend on either having happened. Deleting a Source
  // in a process where nothing has been uploaded yet would otherwise fail on a
  // missing relation, which is the one thing this function cannot do: the row
  // would survive and the user would see the delete bounce. The guard is the
  // same idempotent, memoised one `uploadDoc` uses.
  await ensureVectorIndex();

  const deletedChunks = await vdb
    .delete(documents)
    .where(
      and(
        eq(metadataField(SCOPE_KEYS.owner_id), ownerId),
        eq(metadataField(SCOPE_KEYS.data_source_id), id),
      ),
    )
    .returning({ id: documents.id });

  await db
    .delete(dataSource)
    .where(and(eq(dataSource.id, id), eq(dataSource.ownerId, ownerId)));

  logger.info(
    { ownerId, dataSourceId: id, deletedChunkCount: deletedChunks.length },
    'data source deleted',
  );
  return { id, deletedChunkCount: deletedChunks.length };
}
