/**
 * What the authored development profiles ask the local stack to provision.
 *
 * These are the two decisions behind `pnpm dev`, `pnpm preview` and
 * `pnpm infra:up`: which of the compose profiles a closure declares actually
 * need starting, and what values `compose.yaml` interpolates when they do.
 *
 * They are functions over provider *values* rather than readers of them,
 * because this package cannot read them: a `tooling` package may not depend on
 * `platform`, `shared` or `feature` (turbo boundaries), and the authored
 * profiles live in all three. So the shims at `scripts/resolve-infra.ts` and
 * `scripts/resolve-compose-env.ts` import the profiles and pass the values in.
 * That is also what makes these rules testable: before the split they ran as an
 * import side effect and wrote to stdout, leaving no value to assert.
 *
 * Everything here reads the *authored* development values and never
 * `process.env` (@acme/env ADR 0001 §6). These decide what to PROVISION, so an
 * operator's override would be the wrong input — and in the compose case a
 * circular one, since `compose.sh` exports this output back into the
 * environment.
 */

/**
 * One role's authored provider selection (`MODELS_CHAT`, `MODELS_EMBED`).
 *
 * Structural rather than `@acme/models`' own union, which this package cannot
 * import — and naming the providers here would be a second list to keep in
 * step. `baseUrl` is optional because only the ollama variant declares one, and
 * provisioning is the reader that has to cope with either.
 */
export interface ModelRole {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl?: string;
}

/** The roles a models profile assigns. */
export interface ModelsSelection {
  readonly MODELS_CHAT: ModelRole;
  readonly MODELS_EMBED: ModelRole;
}

/** The authored Stripe connection, narrowed to the field that decides infra. */
export interface StripeConnection {
  readonly mode: string;
}

/** The authored provider values the prune rules decide on. */
export interface ProviderSelection {
  /** `@acme/billing`'s `STRIPE_CONNECTION`. */
  readonly stripe: StripeConnection;
  /** `@acme/models`' role assignments. */
  readonly models: ModelsSelection;
}

/**
 * The role that runs on `provider`, or `undefined` when neither does.
 *
 * Both decisions ask this one question of the same discriminant, for opposite
 * reasons: the prune drops a profile when the answer is `undefined`, the
 * compose environment reads the port off whichever role it names. So they ask
 * it here rather than each destructuring the profile and branching itself.
 */
export function roleUsing(provider: string, models: ModelsSelection) {
  return [models.MODELS_CHAT, models.MODELS_EMBED].find(
    (role) => role.provider === provider,
  );
}

/**
 * The compose profiles a candidate set actually needs, given the authored
 * provider values.
 *
 * The graph yields the candidates (`closureInfra`); a service needed only under
 * a given configuration is pruned here:
 *
 *   - `billing` (localstripe) goes unless the authored Stripe connection is
 *     localstripe — real Stripe needs no local container.
 *   - `ollama` goes unless the chat or embed role runs on ollama.
 *
 * Candidate order is preserved, so a sorted candidate list stays sorted. A
 * profile no rule names is returned untouched: the graph decides what a closure
 * needs, these rules only decide what to drop.
 */
export function pruneInfra(
  candidates: readonly string[],
  selection: ProviderSelection,
) {
  const dropped = new Set<string>();
  if (selection.stripe.mode !== 'localstripe') dropped.add('billing');
  if (!roleUsing('ollama', selection.models)) dropped.add('ollama');
  return candidates.filter((profile) => !dropped.has(profile));
}

/**
 * The port a connection URL names — the single source.
 *
 * A standalone port field beside the URL would be a second source that could
 * drift, so every port in the compose environment is parsed back out of the URL
 * that carries it. Empty when the URL states no port (`new URL` does not fill
 * in the scheme's default), and a throw when the string is no URL at all.
 */
export function portOf(url: string) {
  return new URL(url).port;
}

/** The authored values `compose.yaml` interpolates, by the slice that owns each. */
export interface ComposeEnvironmentInput {
  /** `@acme/db` — the Postgres container's port, superuser and database. */
  readonly db: {
    readonly DB_PORT: number;
    readonly DB_USER: string;
    readonly DB_NAME: string;
  };
  /** `@acme/rag` — the vector database created beside it. */
  readonly rag: {
    readonly DB_VECTOR_NAME: string;
  };
  /** `@acme/redis` — the port is parsed out of the connection URL. */
  readonly redis: {
    readonly REDIS_URL: string;
  };
  /** `@acme/models` — the ollama port and the models to pull. */
  readonly models: ModelsSelection;
}

/**
 * Every value `compose.yaml` interpolates to provision the local stack, as a
 * record. `scripts/resolve-compose-env.ts` renders it and `scripts/compose.sh`
 * exports the result, where compose substitutes the `${...}` refs at parse time.
 *
 * @throws when no role runs on ollama, or the one that does states no base URL.
 * Dev selects ollama for both roles; a guessed port is worse than a loud failure.
 */
export function composeEnvironment({
  db,
  rag,
  redis,
  models,
}: ComposeEnvironmentInput) {
  const ollama = roleUsing('ollama', models);
  if (!ollama?.baseUrl) {
    throw new Error(
      'the models development profile selects no ollama role — cannot derive OLLAMA_PORT',
    );
  }
  return {
    DB_PORT: String(db.DB_PORT),
    DB_USER: db.DB_USER,
    DB_NAME: db.DB_NAME,
    DB_VECTOR_NAME: rag.DB_VECTOR_NAME,
    REDIS_PORT: portOf(redis.REDIS_URL),
    OLLAMA_PORT: portOf(ollama.baseUrl),
    OLLAMA_CHAT_MODEL: models.MODELS_CHAT.model,
    OLLAMA_EMBED_MODEL: models.MODELS_EMBED.model,
  };
}
