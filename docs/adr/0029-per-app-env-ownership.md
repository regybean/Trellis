# Per-app env ownership — deprecate the shared root `.env`

The application env surface used to live in a shared root `.env`, layered under
every app (`with-env` = `dotenv -e ../../.env -- dotenv -e ./.env --`, root
winning). We deprecate that root file: each app now owns its **full** application
env in `apps/<app>/.env`, and its `with-env` loads only that file
(`dotenv -e ./.env --`). Shared model-provider secrets (`AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `OPENROUTER_API_KEY`) are duplicated into all four apps'
`.env.example` by design. This partly supersedes the env-split described in
[ADR 0026](0026-config-as-code.md) (#127).

## Why

- **The slice/app contract wants self-contained apps.** A new bespoke client is a
  new app importing a different subset of features ([README](../../README.md) north
  star). An app that silently inherits half its runtime env from a repo-root file
  isn't self-contained — you can't read `apps/<app>/.env.example` and know what the
  app needs, and you can't lift the app out without also lifting an invisible root
  file. Per-app ownership makes each app's env surface complete and legible on disk.
- **The shared root `.env` was a footgun.** Because root loaded first and `dotenv`
  doesn't override an already-set var, a value in root `.env` silently won over
  every app's own `.env` — the collision [ADR 0008](0008-per-app-redis-namespace.md)
  had to write an amendment to warn against. Removing the shared file removes the
  footgun outright.
- **The shared surface had shrunk to almost nothing.** After the config-as-code
  migration ([ADR 0026](0026-config-as-code.md)), the root `.env` held only
  model-provider secrets plus Stripe secrets — and `STRIPE_API_BASE` had already
  become config-as-code. The remaining shared rows didn't justify a whole extra
  layer with load-order subtleties.

## Scope

- **In:** the root application `.env` / `.env.example` (deleted); all four apps'
  `with-env` (`dotenv -e ./.env --`); root `with-env` (`dotenv -e ./deploy/.env --`);
  each app's `.env.example` gains the model-provider secrets; `SECRET_MAP` in
  `secrets.config.sh` drops `app-shared` and maps all four apps + `infra`;
  `link-worktree-env.mjs` no longer links a root `.env`.
- **Out:** `deploy/.env` (infra container passwords) stays exactly as-is — it is a
  dev-deployment concern owned by compose at the repo root, shared by one local
  stack across all apps, and cannot cleanly move into a single app. Root `with-env`
  still loads it; the app inherits `DB_PASSWORD`/`REDIS_PASSWORD` from the parent
  process when launched via `pnpm dev` / `pnpm with-env`.

## Considered and rejected

- **Keep the shared root `.env` (status quo).** Rejected: it re-introduces the
  ADR 0008 footgun and leaves apps non-self-contained.
- **Promote the shared model secrets to config-as-code instead.** They are genuine
  secrets (leaking grants provider access), so they stay in `process.env` per the
  ADR 0026 rule — config-as-code is for non-secret values only.
- **Fold `deploy/.env` into apps too.** Rejected: compose is repo-level and one
  local stack is shared across apps; there is no single app that owns the container
  passwords.

## Status

accepted

## Consequences

- **Shared secrets are duplicated across apps.** Changing an `OPENROUTER_API_KEY`
  means editing up to four `.env` files. Accepted deliberately: self-containment is
  worth the copy-paste, and the pluggable secrets sync (`env:pull`/`env:push`, now
  mapping every app) rehydrates them from one vault entry per app.
- **The old `app-shared` vault entry is orphaned.** Secrets sync is opt-in and not
  in active use; no live migration is forced. Model/Stripe secrets now live under
  each app's secret name.
- **Standalone per-app commands still need `deploy/.env`.** A per-app `db:push` run
  outside `pnpm dev` must be run under the root `with-env` (or with `DB_PASSWORD` in
  the environment) — unchanged from before, since the app's own `with-env` never
  loaded `deploy/.env`.
