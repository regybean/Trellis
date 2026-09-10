import 'fake-indexeddb/auto';

import { IDBFactory } from 'fake-indexeddb';
import { beforeEach } from 'vitest';

// jsdom has no IndexedDB; `fake-indexeddb/auto` installs an in-memory
// implementation on the global. Swap in a fresh factory before each test so
// persisted caches never leak across cases ([ADR 0001](../../../docs/adr/0001-per-query-indexeddb-persister.md) / ADR 0018).
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
