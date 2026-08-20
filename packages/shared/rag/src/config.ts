import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { coercedBoolean, createConfig } from '@acme/config';

/**
 * RAG config-as-code (ADR 0026). The dedicated vector database name, the chunker
 * knobs, and the conversation-memory tunables (previously hardcoded in
 * `memory.ts`) are non-sensitive values that can differ per deploy target, so
 * they live here rather than in `process.env` / source literals. Server-side —
 * ingestion, the vector store, and memory all run on the backend. The DB
 * connection host/port/creds stay with `@acme/db`; only the vector *name* is rag's.
 */
export function ragConfig(context: ConfigContext) {
  return createConfig({
    server: {
      DB_VECTOR_NAME: z.string().nonempty(),
      CHUNK_SIZE: z.coerce.number().int().positive(),
      CHUNK_OVERLAP: z.coerce.number().int().nonnegative(),
      // Conversation memory: how many trailing turns are loaded into context,
      // whether semantic recall (vector search over history) is on, and the
      // word cap for the auto-generated thread title.
      MEMORY_LAST_MESSAGES: z.coerce.number().int().positive(),
      MEMORY_SEMANTIC_RECALL: coercedBoolean(),
      MEMORY_TITLE_WORD_CAP: z.coerce.number().int().positive(),
    },
    profiles: {
      default: {
        server: {
          DB_VECTOR_NAME: 'vectordb',
          CHUNK_SIZE: 1024,
          CHUNK_OVERLAP: 20,
          MEMORY_LAST_MESSAGES: 15,
          MEMORY_SEMANTIC_RECALL: false,
          MEMORY_TITLE_WORD_CAP: 6,
        },
      },
    },
    context,
  });
}
