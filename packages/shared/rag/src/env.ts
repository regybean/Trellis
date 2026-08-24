import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import {
  jsonEnv,
  readEnv,
  resolveAppEnv,
  webappSchema,
  withProfiles,
} from '@acme/env';

import { RAG_DEVELOPMENT_PROFILE } from './development-profile';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * RAG's environment, declared once (ADR 0033). The dedicated vector database
 * name, the chunker knobs and the conversation-memory tunables (previously
 * hardcoded in `memory.ts`) are authored here as profile values, and every one of
 * them is env-overridable (ADR 0033 §4) — they are the operational knobs most
 * likely to be retuned on a live deploy. The DB connection host/port/creds stay
 * with `@acme/db`; only the vector *name* is rag's. Server-side — ingestion, the
 * vector store and memory all run on the backend.
 *
 * `MEMORY_SEMANTIC_RECALL` goes through `jsonEnv` rather than
 * `z.coerce.boolean()`: coercion is JavaScript truthiness, so `'false'` would
 * become `true` and an operator turning semantic recall off would have turned it
 * on.
 *
 * `NEXT_PUBLIC_WEBAPP` is the per-app schema selector (it names the Postgres
 * schema, read at module load by `schemas/*`), and `NODE_ENV` the runtime mode.
 * Both stay written longhand: they are the keys a bundler inlines textually, and
 * an index access is invisible to that.
 */
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {},
  shared: {
    NODE_ENV: z.enum(['development', 'production', 'test']),
    // Per-app identity — names the Postgres/pgvector schema.
    NEXT_PUBLIC_WEBAPP: webappSchema,
  },
  server: {
    DB_VECTOR_NAME: z.string().nonempty(),
    CHUNK_SIZE: z.coerce.number().int().positive(),
    CHUNK_OVERLAP: z.coerce.number().int().nonnegative(),
    // Conversation memory: how many trailing turns are loaded into context,
    // whether semantic recall (vector search over history) is on, and the word
    // cap for the auto-generated thread title.
    MEMORY_LAST_MESSAGES: z.coerce.number().int().positive(),
    MEMORY_SEMANTIC_RECALL: jsonEnv(z.boolean()),
    MEMORY_TITLE_WORD_CAP: z.coerce.number().int().positive(),
  },
  createFinalSchema: (shape) =>
    withProfiles(shape, appEnv, {
      default: { ...RAG_DEVELOPMENT_PROFILE, NODE_ENV: 'development' },
    }),
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
    DB_VECTOR_NAME: readEnv('DB_VECTOR_NAME'),
    CHUNK_SIZE: readEnv('CHUNK_SIZE'),
    CHUNK_OVERLAP: readEnv('CHUNK_OVERLAP'),
    MEMORY_LAST_MESSAGES: readEnv('MEMORY_LAST_MESSAGES'),
    MEMORY_SEMANTIC_RECALL: readEnv('MEMORY_SEMANTIC_RECALL'),
    MEMORY_TITLE_WORD_CAP: readEnv('MEMORY_TITLE_WORD_CAP'),
  },
  emptyStringAsUndefined: true,
});
