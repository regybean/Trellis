// Resolve every value `compose.yaml` interpolates to provision the local infra
// stack, FROM the slices' authored development profiles — the single source of
// truth (@acme/env ADR 0001 §6, #126) — so `.env`/`.env.example` no longer carry (and can't
// drift from) them. `scripts/compose.sh` runs this and exports the printed
// `KEY=value` lines into the environment, where compose substitutes the `${...}`
// refs at parse time.
//
// The provisioning inputs and their homes:
//   DB_PORT / DB_USER / DB_NAME               ← @acme/db     (DB_DEVELOPMENT_PROFILE)
//   DB_VECTOR_NAME                            ← @acme/rag    (RAG_DEVELOPMENT_PROFILE)
//   REDIS_PORT                                ← @acme/redis  (parsed from REDIS_URL)
//   OLLAMA_PORT                               ← @acme/models (parsed from the ollama baseUrl)
//   OLLAMA_CHAT_MODEL / _EMBED_MODEL          ← @acme/models (the ollama pull list)
//
// Ports are PARSED out of the connection URLs (`REDIS_URL`, the ollama `baseUrl`)
// rather than stored as standalone fields — a second port field would be a drift
// source. Everything is read from the `development` profile: infra is a local
// dev/test concern and ollama is the dev default with no staging/production
// override, so development is authoritative.
//
// The `development-profile.ts` modules are imported rather than each slice's
// `env.ts` **deliberately**: this script PROVISIONS the stack, so it must see the
// values the repo authors and never an operator's override — reading an override
// here would be circular, since `compose.sh` exports this output back into the
// environment. Those modules also execute no `createEnv` call, so provisioning
// doesn't have to satisfy every slice's selectors just to read a port.
//
// Run via `pnpm exec tsx`: plain node can't load the workspace TS config graph
// (its relative imports are extensionless). Profiles are imported by relative path
// into the package source rather than the `@acme/*` specifier — declaring them as
// root workspace deps would make the untagged root package depend on tagged ones,
// which turbo boundaries rejects; tsx resolves the transitive imports from each
// package's own node_modules.
import { DB_DEVELOPMENT_PROFILE } from "../packages/platform/db/src/development-profile";
import { REDIS_DEVELOPMENT_PROFILE } from "../packages/platform/redis/src/development-profile";
import { MODELS_DEVELOPMENT_PROFILE } from "../packages/shared/models/src/development-profile";
import { RAG_DEVELOPMENT_PROFILE } from "../packages/shared/rag/src/development-profile";

// Port parsed from a connection URL — the single source; a standalone field
// would be a second source that could drift.
const portOf = (url: string) => new URL(url).port;

// The ollama service port comes from whichever role runs on ollama (dev selects
// it for both). `baseUrl` exists only on the ollama variant of each role union,
// so narrow on the discriminant before reading it. Dev is always ollama; if a
// profile somehow selects neither, fail loud rather than guess a port.
const { MODELS_CHAT: chat, MODELS_EMBED: embed } = MODELS_DEVELOPMENT_PROFILE;
const ollamaBaseUrl =
  chat.provider === "ollama"
    ? chat.baseUrl
    : embed.provider === "ollama"
      ? embed.baseUrl
      : undefined;
if (!ollamaBaseUrl) {
  throw new Error(
    "resolve-compose-env: no ollama role in the models development profile — cannot derive OLLAMA_PORT",
  );
}

process.stdout.write(
  [
    `DB_PORT=${DB_DEVELOPMENT_PROFILE.DB_PORT}`,
    `DB_USER=${DB_DEVELOPMENT_PROFILE.DB_USER}`,
    `DB_NAME=${DB_DEVELOPMENT_PROFILE.DB_NAME}`,
    `DB_VECTOR_NAME=${RAG_DEVELOPMENT_PROFILE.DB_VECTOR_NAME}`,
    `REDIS_PORT=${portOf(REDIS_DEVELOPMENT_PROFILE.REDIS_URL)}`,
    `OLLAMA_PORT=${portOf(ollamaBaseUrl)}`,
    `OLLAMA_CHAT_MODEL=${chat.model}`,
    `OLLAMA_EMBED_MODEL=${embed.model}`,
    "",
  ].join("\n"),
);
