// Resolve the Ollama model IDs the local ollama service must PULL, FROM
// `@acme/models` config — the single source of truth (ADR 0026, #120) — so
// `.env.example`/`.env` no longer duplicate the literals and can't drift.
// `scripts/compose.sh` runs this and exports the printed `KEY=value` lines into
// the environment, where compose interpolates the `${OLLAMA_*_MODEL}` refs in
// compose.yaml's ollama service.
//
// Run via `pnpm exec tsx`: plain node can't load the workspace TS config graph
// (its relative imports are extensionless). Ollama is the dev/test default (ADR
// 0026) with no staging/production profile overrides, so the development profile
// is authoritative for the pull list.
//
// Imported by relative path into the package's config source rather than the
// `@acme/models/config` specifier: declaring `@acme/models` as a root workspace
// dependency would make the untagged root package depend on a `shared`-tagged
// one, which turbo boundaries rejects. tsx resolves the transitive imports
// (`@acme/config`, `zod`) from the models package's own node_modules.
import { modelsConfig } from "../packages/shared/models/src/config";

const config = modelsConfig({ appEnv: "development", isServer: true });

// The development profile selects Ollama for both roles (ADR 0026), so the chat
// and embed model ids are the ollama variants' `model` fields. `model` is common
// to every variant of each union, so this reads without narrowing.
process.stdout.write(
  [
    `OLLAMA_CHAT_MODEL=${config.chat.model}`,
    `OLLAMA_EMBED_MODEL=${config.embed.model}`,
    "",
  ].join("\n"),
);
