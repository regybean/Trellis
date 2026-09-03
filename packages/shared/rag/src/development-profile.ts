/**
 * The authored **development** profile for this slice's env, in a module that
 * executes no `createEnv` call.
 *
 * `env.ts` authors its `default` profile from this object, and
 * `scripts/resolve-compose-env.ts` reads it *without* an environment:
 * `DB_VECTOR_NAME` names the vector database compose creates, and provisioning
 * wants the authored value rather than an operator's override (@acme/env ADR 0001 §6).
 * Overriding the variable therefore points a *connection* at a different
 * database; it does not rename the one compose provisions.
 */
export const RAG_DEVELOPMENT_PROFILE = {
  DB_VECTOR_NAME: 'vectordb',
  CHUNK_SIZE: 1024,
  CHUNK_OVERLAP: 20,
  MEMORY_LAST_MESSAGES: 15,
  MEMORY_SEMANTIC_RECALL: false,
  MEMORY_TITLE_WORD_CAP: 6,
} as const;
