// Resolve every value `compose.yaml` interpolates to provision the local infra
// stack, FROM the slice configs — the single source of truth (ADR 0026, #126) —
// so `.env`/`.env.example` no longer carry (and can't drift from) them.
// `scripts/compose.sh` runs this and exports the printed `KEY=value` lines into
// the environment, where compose substitutes the `${...}` refs at parse time.
//
// The provisioning inputs and their config homes:
//   DB_PORT / DB_USER / DB_NAME   ← @acme/db      (dbConfig)
//   DB_VECTOR_NAME                ← @acme/rag     (ragConfig)
//   REDIS_PORT                    ← @acme/redis   (redisConfig, parsed from REDIS_URL)
//   OLLAMA_PORT                   ← @acme/models  (modelsConfig, parsed from the ollama baseUrl)
//   OLLAMA_CHAT_MODEL / _EMBED_MODEL ← @acme/models (modelsConfig, the ollama pull list)
//
// Ports are PARSED out of the connection URLs (`REDIS_URL`, the ollama `baseUrl`)
// rather than stored as standalone fields — a second port field would be a drift
// source. Everything is read from the `development` profile: infra is a local
// dev/test concern and ollama is the dev default (ADR 0026) with no
// staging/production override, so development is authoritative (mirrors the
// former resolve-ollama-models.ts / resolve-infra.ts).
//
// Run via `pnpm exec tsx`: plain node can't load the workspace TS config graph
// (its relative imports are extensionless). Configs are imported by relative path
// into the package source rather than the `@acme/*` specifier — declaring them as
// root workspace deps would make the untagged root package depend on tagged ones,
// which turbo boundaries rejects; tsx resolves the transitive imports from each
// package's own node_modules.
import { dbConfig } from "../packages/platform/db/src/config";
import { redisConfig } from "../packages/platform/redis/src/config";
import { modelsConfig } from "../packages/shared/models/src/config";
import { ragConfig } from "../packages/shared/rag/src/config";

const context = { appEnv: "development", isServer: true } as const;

const db = dbConfig(context);
const rag = ragConfig(context);
const redis = redisConfig(context);
const models = modelsConfig(context);

// Port parsed from a connection URL — the single source; a standalone field
// would be a second source that could drift.
const portOf = (url: string) => new URL(url).port;

// The ollama service port comes from whichever role runs on ollama (dev selects
// it for both). `baseUrl` exists only on the ollama variant of each role union,
// so narrow on the discriminant before reading it. Dev is always ollama (ADR
// 0026); if a config somehow selects neither, fail loud rather than guess a port.
const ollamaBaseUrl =
  models.chat.provider === "ollama"
    ? models.chat.baseUrl
    : models.embed.provider === "ollama"
      ? models.embed.baseUrl
      : undefined;
if (!ollamaBaseUrl) {
  throw new Error(
    "resolve-compose-env: no ollama role in modelsConfig — cannot derive OLLAMA_PORT",
  );
}

process.stdout.write(
  [
    `DB_PORT=${db.DB_PORT}`,
    `DB_USER=${db.DB_USER}`,
    `DB_NAME=${db.DB_NAME}`,
    `DB_VECTOR_NAME=${rag.DB_VECTOR_NAME}`,
    `REDIS_PORT=${portOf(redis.REDIS_URL)}`,
    `OLLAMA_PORT=${portOf(ollamaBaseUrl)}`,
    `OLLAMA_CHAT_MODEL=${models.chat.model}`,
    `OLLAMA_EMBED_MODEL=${models.embed.model}`,
    "",
  ].join("\n"),
);
