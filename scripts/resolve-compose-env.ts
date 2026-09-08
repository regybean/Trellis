// Every value `compose.yaml` interpolates to provision the local infra stack,
// printed as `KEY=value` lines. `scripts/compose.sh` runs this and exports the
// lines into the environment, where compose substitutes the `${...}` refs at
// parse time.
//
// The values come FROM the slices' authored development profiles — the single
// source of truth (@acme/env ADR 0001 §6, #126) — so `.env`/`.env.example` no
// longer carry (and can't drift from) them. Which value comes from where, and
// which ports are parsed out of a connection URL rather than stored beside it,
// is `composeEnvironment` in `@acme/workspace-graph`. It returns the record;
// this file hands it the profiles and writes what comes back.
//
// The provisioning inputs and their homes:
//   DB_PORT / DB_USER / DB_NAME               ← @acme/db     (DB_DEVELOPMENT_PROFILE)
//   DB_VECTOR_NAME                            ← @acme/rag    (RAG_DEVELOPMENT_PROFILE)
//   REDIS_PORT                                ← @acme/redis  (parsed from REDIS_URL)
//   OLLAMA_PORT                               ← @acme/models (parsed from the ollama baseUrl)
//   OLLAMA_CHAT_MODEL / _EMBED_MODEL          ← @acme/models (the ollama pull list)
//
// Everything is read from the `development` profile: infra is a local dev/test
// concern and ollama is the dev default with no staging/production override, so
// development is authoritative.
//
// The `development-profile.ts` modules are imported rather than each slice's
// `env.ts` **deliberately**: this script PROVISIONS the stack, so it must see
// the values the repo authors and never an operator's override — reading an
// override here would be circular, since `compose.sh` exports this output back
// into the environment. Those modules also execute no `createEnv` call, so
// provisioning doesn't have to satisfy every slice's selectors just to read a
// port.
//
// Run via `pnpm exec tsx`: plain node can't load the workspace TS config graph
// (its relative imports are extensionless). Profiles are imported by relative
// path into the package source rather than the `@acme/*` specifier — declaring
// them as root workspace deps would make the untagged root package depend on
// tagged ones, which turbo boundaries rejects; tsx resolves the transitive
// imports from each package's own node_modules. That import is also why the
// decisions live in `@acme/workspace-graph` and this file does not: a `tooling`
// package may depend on `tooling` only, so it cannot read a profile itself.
import { DB_DEVELOPMENT_PROFILE } from "../packages/platform/db/src/development-profile";
import { REDIS_DEVELOPMENT_PROFILE } from "../packages/platform/redis/src/development-profile";
import { MODELS_DEVELOPMENT_PROFILE } from "../packages/shared/models/src/development-profile";
import { RAG_DEVELOPMENT_PROFILE } from "../packages/shared/rag/src/development-profile";
import { composeEnvironment } from "../tooling/workspace-graph/src/index";

const environment = composeEnvironment({
  db: DB_DEVELOPMENT_PROFILE,
  rag: RAG_DEVELOPMENT_PROFILE,
  redis: REDIS_DEVELOPMENT_PROFILE,
  models: MODELS_DEVELOPMENT_PROFILE,
});

process.stdout.write(
  [
    ...Object.entries(environment).map(([key, value]) => `${key}=${value}`),
    "",
  ].join("\n"),
);
