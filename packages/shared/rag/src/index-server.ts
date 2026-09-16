import 'server-only';

// The Data Source module. Note what is NOT here: the db clients, the filter
// builder, and the `data_source` table itself (that is `./schema`, for
// drizzle-kit). Every read and write goes through these functions, so the
// ownership rule cannot be bypassed — see `data-source.ts`.
export {
  assertDataSourceOwned,
  createDataSource,
  DataSourceOwnershipError,
  DataSourceQuotaError,
  deleteDataSource,
  listDataSources,
  renameDataSource,
  resolveRetrievalScope,
  retrievalContextSchema,
} from './data-source';
export type { DataSourceScope } from './data-source';
export {
  deleteByFilename,
  DocumentParseError,
  listDocuments,
  uploadDoc,
} from './document-uploader';
export type {
  DocumentFilenameSummary,
  RagUploadStage,
  StageReporter,
  UploadDocOptions,
} from './document-uploader';
export { extractText } from './parsing';
export { ensureVectorIndex } from './vector';
