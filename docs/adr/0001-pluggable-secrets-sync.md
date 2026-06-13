# Pluggable secrets sync with `.env.example` as the contract

`env:pull` / `env:push` keep local `.env` files in sync, but the backend is now
pluggable: each script sources `secrets.config.sh` (selecting a `SECRETS_BACKEND`)
and a one-function-pair adapter from `scripts/secrets-backends/<name>.sh`
(`fetch_secret` / `put_secret`). The default is `dotenv-file` (gitignored local
JSON, zero setup); `aws.sh` is the worked example. `<file>.example` is the source
of truth for which keys exist and which are secret: a non-empty value is
non-secret config that lives in the repo; an empty value (and never a
`NEXT_PUBLIC_*` key) is a secret that lives only in the backend. This keeps
non-secret config out of the vault and makes one-command onboarding work on any
provider.

## Considered options

- **SOPS / age (encrypted-in-repo)** — rejected: changes the model to committing
  encrypted blobs and re-committing on rotation, rather than a live vault.
- **Doppler / Infisical (SaaS)** — rejected: forces a vendor account on every
  adopter of this public template.
- **AWS Secrets Manager only (the original)** — rejected: hard-codes one cloud,
  so adopters on other providers can't onboard.
- **Plain `.env.example`, no sync** — rejected: loses the one-command
  "pull every secret" onboarding UX the team relies on.

## Consequences

- The two-function adapter contract is load-bearing: changing it means revisiting
  every adapter, so it should change rarely.
- `.env.example` is now an input to the scripts, not just documentation — every
  key must be declared there, and a key's emptiness decides its sensitivity.
