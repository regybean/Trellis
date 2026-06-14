// Database schema exports — safe to import in any context (CLI, server, client
// build). No server-only guard, so drizzle-kit can load the schemas.
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
