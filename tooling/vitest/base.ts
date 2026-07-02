import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: {
      NODE_ENV: 'test',
      SKIP_ENV_VALIDATION: 'true',
      // Static, non-secret env so every package's `env.ts` (createEnv) validates
      // against real values instead of being mocked. Dynamic DB/Redis connection
      // details are hydrated per-run from testcontainers by
      // `@acme/test-utils/hydrate-env`. See tooling/test-utils/src/hydrate-env.ts.
      //
      // Provider selection + model ids: ai-sdk factories only build config
      // objects at import (no network), so `@acme/models` resolve.ts constructs
      // fine with these — no `@acme/models` mock needed.
      LLM_PROVIDER: 'ollama',
      EMBED_PROVIDER: 'ollama',
      EMBED_DIMENSIONS: '768',
      OLLAMA_BASE_URL: 'http://localhost:11434/v1',
      OLLAMA_CHAT_MODEL: 'test-chat',
      OLLAMA_EMBED_MODEL: 'test-embed',
      // @acme/rag: dedicated vector db name (CHUNK_SIZE/OVERLAP have defaults).
      DB_VECTOR_NAME: 'vectordb',
    },
    mockReset: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['verbose'],
    passWithNoTests: true,
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html'],
    },
  },
});
