/**
 * What this slice says about the local `ollama` service, for
 * `@acme/workspace-graph` to discover through this package's
 * `acme.provisioning` — the contract is stated in that package's
 * `src/provisioning.ts`.
 *
 * Two contributions, both read off the **authored** development selection and
 * never `process.env` (this decides what to PROVISION, so an operator's
 * override would be the wrong input — [@acme/env ADR 0001](../../../platform/env/docs/adr/0001-one-env-factory-per-slice.md) §6):
 *
 *   - whether the service is `needed` at all. The graph only records that a
 *     package does LLM/embeddings ([ADR 0009](../../../../docs/adr/0009-graph-derived-dev-infra.md)); which provider serves that is
 *     this slice's authored choice, so a selection on Bedrock/OpenRouter prunes
 *     the container away.
 *   - the port to publish it on and the models to pull, when it is.
 *
 * The port is parsed back out of the base URL that carries it rather than stored
 * beside it — a second field would be a drift source.
 */
import { MODELS_DEVELOPMENT_PROFILE } from './development-profile';

/**
 * What provisioning reads off a role, structurally.
 *
 * Not the role union from `model-schemas.ts`: this reads the authored literal,
 * so its `provider` is a single string type and `role.provider === 'ollama'`
 * reads as a dead condition. `baseUrl` is optional because only the ollama
 * variant declares one, and this is the reader that has to cope with either.
 */
interface RoleValues {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl?: string;
}

const { MODELS_CHAT, MODELS_EMBED } = MODELS_DEVELOPMENT_PROFILE;
const roles: readonly RoleValues[] = [MODELS_CHAT, MODELS_EMBED];

/** The role that runs on ollama — chat first — or `undefined` when neither does. */
const baseUrl = roles.find((role) => role.provider === 'ollama')?.baseUrl;

export const PROVISIONING = {
  ollama: {
    needed: baseUrl !== undefined,
    compose: baseUrl
      ? {
          OLLAMA_PORT: new URL(baseUrl).port,
          OLLAMA_CHAT_MODEL: MODELS_CHAT.model,
          OLLAMA_EMBED_MODEL: MODELS_EMBED.model,
        }
      : {},
  },
};
