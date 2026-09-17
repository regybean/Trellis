// Database schema exports — safe to import in any context (CLI, server, client
// build). No server-only guard, so drizzle-kit can load the schemas.
//
// This barrel now spans TWO databases, and that is worth stating because
// nothing in the export list shows it. `mastra_documents` (the knowledge base)
// and the Mastra Memory tables live in the dedicated vector database with
// Mastra owning their DDL; `data_source` is app-owned and drizzle-kit-managed in
// the app database. Both namespace under the same per-app Postgres schema name
// (`NEXT_PUBLIC_WEBAPP`), so the names collide harmlessly across the two.
//
// Two consequences:
//
//   1. The apps re-export from here by NAME rather than `export *`, so only
//      `data_source` becomes push-managed. Belt and braces: the app database's
//      push config also carries a `!mastra_*` tables filter, and the
//      knowledge-base table is physically named `mastra_documents`, so the
//      filter covers it by name even though it lives in another database.
//   2. Deleting a Data Source has to delete its chunks and its row across that
//      boundary, so the cascade can be neither a foreign key nor a transaction.
//      It is non-atomic by necessity rather than oversight — chunks first, so an
//      interrupted delete leaves a visible Source with fewer Documents that
//      retrying finishes, never orphaned chunks nothing can reach. See
//      `data-source.ts`.
export {
  dataSource,
  selectDataSourceSchema,
  DataSourceName,
  CreateDataSourceRequest,
  RenameDataSourceRequest,
  DeleteDataSourceRequest,
  MAX_SOURCE_SELECTION,
  SourceSelection,
} from './schemas/data-source-schema';
export type { SelectDataSource } from './schemas/data-source-schema';
export {
  documents,
  selectDocumentSchema,
  EMBED_DIMENSIONS,
} from './schemas/documents-schema';
export type {
  DocumentMetadata,
  SelectDocument,
} from './schemas/documents-schema';
export {
  mastraThreads,
  mastraMessages,
  mastraResources,
  selectThreadSchema,
} from './schemas/memory-schema';
export type { SelectThread } from './schemas/memory-schema';
