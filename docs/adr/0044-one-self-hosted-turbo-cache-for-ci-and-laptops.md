# One self-hosted turbo cache, for CI and laptops alike

**Status:** accepted

Remote caching was adopted so a laptop and CI could reuse each other's work.
Vercel was the store on both sides, and the sharing was the point.

The store has a ceiling. Vercel's Hobby tier allows **100 artifact requests per
minute, scoped to the owner**
([Vercel docs](https://vercel.com/docs/monorepos/remote-caching#usage)). Turbo
issues one request per task, hit or miss. The
[remote cache spec](https://turborepo.dev/api/remote-cache-spec) defines a
`POST /artifacts` batch lookup and calls it "optional for basic cache
functionality but enables optimized cache fetching"; turbo never calls it — the
only endpoints its client builds are `/v8/artifacts/{hash}`,
`/v8/artifacts/status` and `/v8/artifacts/events`. Request count is task count,
and no flag changes that.

This workflow's jobs start together, each resolving `^build` for itself. The
measured task count is 208 across five jobs, inside roughly a minute. Owner
scope means two concurrent pull requests share the same 100, so the burst is not
a per-run quantity anybody can budget against.

## Decision

**We run the remote cache. One store, reached identically from CI and from a
laptop.**

[`AdiRishi/turborepo-remote-cache-cloudflare`](https://github.com/AdiRishi/turborepo-remote-cache-cloudflare)
implements the protocol as a Cloudflare Worker over R2. Turbo cannot tell the
difference: same endpoints, same hashes, same bearer auth.

**Configuration is three environment variables and no plumbing.** `TURBO_API`,
`TURBO_TEAM`, `TURBO_TOKEN`. In CI they are repo variables and a repo secret; on
a laptop they come from the shell. `./.github/actions/setup` asserts the first
two are present, because an unset `TURBO_API` is the dangerous case rather than a
loud one: turbo falls back to a default `apiUrl` of `https://vercel.com`, so a
missing variable sends traffic to Vercel bearing a token Vercel never issued,
and the symptom reads as "caching is broken somehow".

**The endpoint is a repo variable, not `remoteCache.apiUrl` in `turbo.json`.**
Committing it would work — the field exists for exactly this — but this
repository is a template, and a fork would inherit our cache URL and fail
against it. The endpoint is deployment configuration, so it lives with the
deployment.

**`TURBO_TEAM` is load-bearing and it is the easy thing to get wrong.** The
worker keys every object `<team>/<hash>`. CI and a laptop disagreeing on the
value is not an error anybody sees; it is two namespaces, each warm, never
sharing a hit. `scripts/wizards/turbo-cache-setup.sh` captures it once and
writes it to both places so the two cannot drift.

**Serverless, so there is nothing to keep up.** R2 is free to 10GB with no
egress charge, and Workers' free tier is 100k requests a day against our ~200
per run. The worker expires artifacts after 720h via a daily cron, which is the
retention policy we would otherwise have had to invent.

## Considered and rejected

- **Vercel Pro.** Raises the limit a hundredfold and the problem disappears. Not
  a decision this repo gets to make.
- **Staying on Vercel and shaping the burst** — collapsing the five turbo jobs
  into one, capping concurrency. Keeps the single store for free, and measured at
  146 requests where the fan-out costs 208. Rejected because it cannot be made
  safe rather than merely likely: turbo front-loads lookups, and the limit is
  owner-scoped, so two concurrent pull requests breach it however well one run
  behaves.
- **The GitHub Actions cache as the store,** via
  `rharkor/caching-for-turbo`. This was implemented and then reverted. It removes
  the rate limit and needs no infrastructure, and it structurally cannot be
  shared: the
  [REST API for Actions Cache](https://docs.github.com/en/rest/actions/cache)
  exposes only list, delete and usage, with no endpoint that reads or writes an
  entry's contents. Transfer runs over an internal service authenticated by
  `ACTIONS_RUNTIME_TOKEN`, minted per job and dead with it. A laptop cannot
  reach it at any price. It also scopes a cache created on a pull request so it
  "cannot be restored by the base branch or other pull requests targeting that
  base branch"
  ([GitHub docs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)),
  so pull requests would never warm each other.
- **`actions/cache` on `.turbo`,** which the
  [official guide documents](https://turborepo.dev/docs/guides/ci-vendors/github-actions).
  Same unshareable-with-a-laptop problem, plus the key strategy becomes ours to
  maintain.
- **Fanning `build`'s `.turbo/cache` out to the other jobs via
  `upload-artifact`.** Shares within a run and nothing across runs. Also had a
  live defect worth recording: `upload-artifact` excludes paths under
  dot-directories, so without `include-hidden-files` the artifact was empty, and
  `continue-on-error` on the download hid it.
- **`TURBO_REMOTE_CACHE_READ_ONLY` on downstream jobs.** Suppresses uploads and
  none of the 208 lookups, so it never addressed the limit.
- **[`ducktors/turborepo-remote-cache`](https://github.com/ducktors/turborepo-remote-cache)**,
  at 1485 stars the most popular implementation by a wide margin, and
  [`brunojppb/turbo-cache-server`](https://github.com/brunojppb/turbo-cache-server),
  the most actively released. Both are good and both would work. Both want
  somewhere to run — a container, Lambda, Cloud Run — and the Worker wants
  nowhere. If Cloudflare ever becomes the wrong dependency, either is a
  swap of `TURBO_API`, because that is all the repo knows about the cache.

## Consequences

- **We own an availability dependency on a cache.** When the worker is down
  turbo degrades to local-only with a warning, so the failure is slow rather
  than broken. Nothing in CI or dev blocks on it.
- **Laptop setup is no longer `turbo login`.** Three variables have to be in the
  shell, because `pnpm lint` and `pnpm typecheck` never go through
  `pnpm with-env` and so never see a `.env`. The wizard writes
  `.turbo-cache.env` and sources it from the profile; `scripts/check-remote-cache.sh`
  fails `predev` with that remediation when a machine is not wired up.
- **The cache token is a shared secret in every developer's shell.** Weaker
  hygiene than a per-user Vercel token, and the price of self-hosting. Rotating
  it means `wrangler secret put`, one repo secret, and every laptop.
- **`needs: build` stays on `lint`, `typecheck` and `test`.** Without it four
  jobs build the same packages concurrently on a cold cache. The serialization
  costs the build's duration warm, against paying for the build four times cold.
- **`--affected` needs `globalDependencies` to stay honest.** Unrelated to the
  store, and load-bearing next to it: outside a package turbo treats only
  `turbo.json` and the lockfile as invalidating the graph, so a pull request
  touching `scripts/test.sh` ran zero test tasks and passed. The root files that
  feed a task are now declared in `turbo.json`. A new one belongs in that list.
