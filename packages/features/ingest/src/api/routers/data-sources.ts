import { mapDataSourceError } from '@acme/rag/ownership-trpc';
import {
  CreateDataSourceRequest,
  DeleteDataSourceRequest,
  RenameDataSourceRequest,
} from '@acme/rag/schema';
import {
  createDataSource,
  deleteDataSource,
  listDataSources,
  renameDataSource,
} from '@acme/rag/server';

import { createTRPCRouter, protectedProcedure } from '../trpc';

/**
 * Data Source management, from the documents page's rail.
 *
 * Every procedure is a thin call into `@acme/rag/server` — the owner check, the
 * name rule, the per-user cap and the cross-database cascade all live there,
 * once, because `@acme/chat` exposes the same operations from the composer
 * panel and two expressions of the ownership rule would make a divergence a
 * cross-user leak.
 *
 * Note what ingest does NOT gain here: a database client. Its tRPC context is
 * still exactly `BaseContext`, because every `data_source` read and write goes
 * through rag's module-private clients. That is a property this router
 * preserves on purpose rather than one it happens not to break — the moment a
 * `db` lands in ingest's context, the ownership predicate becomes bypassable
 * from this package.
 */
export const dataSourcesRouter = createTRPCRouter({
  /** The caller's own Data Sources, oldest first. */
  list: protectedProcedure.query(({ ctx }) =>
    listDataSources({ ownerId: ctx.session.user.id }),
  ),

  /**
   * Create a Data Source under a client-minted id, so the rail row can appear
   * optimistically and still reconcile 1:1 with the server row. Safe only
   * because the retrieval filter's first clause is `owner_id = <verified
   * userId>`.
   *
   * The per-user cap is rag's, not this router's: a second expression of it
   * here would be a number to keep in step with `@acme/chat`'s create.
   */
  create: protectedProcedure
    .input(CreateDataSourceRequest)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createDataSource({
          ownerId: ctx.session.user.id,
          id: input.id,
          name: input.name,
        });
      } catch (error) {
        mapDataSourceError(error);
      }
    }),

  /** Rename a Data Source. Touches zero chunks — identity is the id. */
  rename: protectedProcedure
    .input(RenameDataSourceRequest)
    .mutation(async ({ ctx, input }) => {
      try {
        return await renameDataSource({
          ownerId: ctx.session.user.id,
          id: input.id,
          name: input.name,
        });
      } catch (error) {
        mapDataSourceError(error);
      }
    }),

  /**
   * Delete a Data Source and every chunk in it. The cascade crosses a database
   * boundary, so it is chunks-then-row and idempotently retryable; the
   * type-the-name confirmation that guards it is the client's.
   */
  delete: protectedProcedure
    .input(DeleteDataSourceRequest)
    .mutation(async ({ ctx, input }) => {
      try {
        return await deleteDataSource({
          ownerId: ctx.session.user.id,
          id: input.id,
        });
      } catch (error) {
        mapDataSourceError(error);
      }
    }),
});
