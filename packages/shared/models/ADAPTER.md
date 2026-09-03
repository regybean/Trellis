# Mounting `@acme/models`

The provider seam for model inference. Your app selects a provider per role;
features ask for a role and get whatever you selected
([ADR 0003](docs/adr/0001-multi-provider-models.md)).

## What it gives you

- Role-based model resolution. A feature asks for the chat model or the
  embedding model, never for a named provider, so swapping providers touches
  configuration and no feature code.
- A choice of providers behind one interface — hosted APIs or a local runtime —
  selected per role rather than per app, so you can embed locally and generate
  against a hosted model.
- Configuration shaped so a half-specified provider cannot be represented: a
  role is set as a whole value, not field by field.

## Surface

| Import             | What's in it                         | Runs   |
| ------------------ | ------------------------------------ | ------ |
| `@acme/models`     | Role resolution and the provider set | server |
| `@acme/models/env` | This package's env factory           | either |

## Wiring

- Compose the env factory and select a provider for each role —
  [env.md](../../../docs/mounting/env.md).
- Resolve at boot, in the same place you initialise telemetry, so a
  misconfigured role fails at startup rather than on the first generation.
- Do the same in your worker entrypoint, since background jobs generate too —
  [worker.md](../../../docs/mounting/worker.md).
- Provide credentials for whichever hosted provider you select. They belong to
  that provider's own configuration, not to this package's env.

## Env

Both keys are profile-authored config — one per role, each an env-overridable
whole value naming the provider and its model. See `src/env.ts`.

## Infra

None declared. This package **decides** whether local inference is needed: pick
a hosted provider for every role and the local runtime service drops out of your
required set — [infra.md](../../../docs/mounting/infra.md).
