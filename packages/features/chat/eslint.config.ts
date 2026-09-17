import {
  banConsole,
  baseConfig,
  containmentOverride,
  restrictEnvAccess,
} from '@acme/eslint-config/base';
import { reactConfig } from '@acme/eslint-config/react';
import { securityConfig } from '@acme/eslint-config/security';
import { testingConfig } from '@acme/eslint-config/testing';

// The wrapper that owns the single `chatAgent.stream` call. Named once, used by
// both the ban and the exemption below so they cannot drift apart.
const STREAM_CALL_SITE = 'src/api/services/chat-turn-stream.ts';

/**
 * Exactly one `chatAgent.stream` call site exists, and this is what enforces it.
 *
 * Mastra's retrieval tool is fail-OPEN: a `stream` call with no request context
 * yields `enableFilter: false` and retrieves over every user's chunks, silently.
 * So the guarantee cannot rest on remembering to pass a scope — the call itself
 * is unavailable outside `streamScopedTurn`, which cannot build a scope without
 * asserting ownership first.
 *
 * The CALL is banned, not the `chatAgent` import. Studio registration
 * (`src/mastra/index.ts`) imports the agent and never streams; the backend
 * suite's LLM stub is a `vi.spyOn(chatAgent, 'stream')` call, which this
 * selector does not match. An import ban was rejected: it would have to
 * whitelist all of `tests/**`, which reopens the hole for any future test that
 * streams for real.
 *
 * Known gap, accepted: the selector matches the identifier, so aliasing the
 * import (`import { chatAgent as agent }`) defeats it. Closing that would need
 * type-aware analysis for a case no honest change produces.
 */
const banAgentStream = {
  selector:
    "CallExpression[callee.object.name='chatAgent'][callee.property.name='stream']",
  message: `chatAgent.stream has exactly one call site: ${STREAM_CALL_SITE}. Retrieval is fail-open without a scoped request context, so stream a Turn through streamScopedTurn instead.`,
};

// `no-restricted-syntax` takes an option ARRAY, and flat config replaces rule
// options rather than merging them — so every block below that sets this rule
// has to re-carry the shared `banConsole` (imported from the base config, not
// restated) or it silently drops out of force.

export default [
  {
    ignores: ['.next/**'],
  },
  ...baseConfig,
  ...reactConfig,
  ...securityConfig,
  ...restrictEnvAccess,
  ...testingConfig,
  // Blessed Mastra home; still a feature, so components keep the no-direct-tRPC
  // slice contract.
  ...containmentOverride({ allowMastra: true, feature: true }),
  {
    // Frontend tests are excluded rather than covered: the base config gives
    // them their own `no-restricted-syntax` block (the MSW/seam-mock doctrine),
    // and a later block matching them would replace it. Nothing under
    // `tests/frontend/` can reach `chatAgent` anyway — it pulls in
    // `server-only` through rag.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/tests/frontend/**'],
    rules: {
      'no-restricted-syntax': ['error', banConsole, banAgentStream],
    },
  },
  {
    // The one exemption. Re-carries `banConsole` for the replace-not-merge
    // reason above.
    files: [STREAM_CALL_SITE],
    rules: {
      'no-restricted-syntax': ['error', banConsole],
    },
  },
];
