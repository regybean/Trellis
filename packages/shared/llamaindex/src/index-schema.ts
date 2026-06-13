// Exports for database schema - can be imported in any context (CLI, server, client build)
// Does NOT include server-only guard to allow drizzle-kit to load schemas
export { documents, selectDocumentSchema } from './schemas/documents-schema';
export type {
  DocumentMetadata,
  SelectDocument,
} from './schemas/documents-schema';
