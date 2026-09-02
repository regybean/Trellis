import 'server-only';

// `@acme/rag` has no client-safe runtime: every export below opens a Postgres
// connection with credentials at import (`pgVector`, `postgresStore`, `memory`)
// or reads through one (`assertThreadOwned`). So the root entry carries the same
// `server-only` guard `./server` does — a stray import from a client component
// fails the build instead of bundling vector machinery for the browser.
export { pgVector, indexName } from './vector';
export { postgresStore } from './storage';
export { memory } from './memory';
export { assertThreadOwned, ThreadOwnershipError } from './ownership';
export type { OwnedThread } from './ownership';
