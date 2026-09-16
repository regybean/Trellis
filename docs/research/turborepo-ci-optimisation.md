# Turborepo CI optimisation: remote-cache request volume, `--affected`, and job topology

Research note. Evaluates the plan in `CI: cutting Vercel remote-cache requests` against
primary sources (turborepo.dev docs, `vercel/turborepo` source and issues, vercel.com/docs,
real `.github/workflows` files) and against this repo, measured locally at turbo 2.7.5.

---

## 1. Verdict

The plan's measurements are right — I reproduced 24/52/56/42/34 = 208 exactly — and change 1
is free money. But the plan optimises the wrong quantity. Vercel documents the Hobby limit as
**100 artifact requests per _minute_, scoped to the `owner`**, not per run
([vercel.com/docs/monorepos/remote-caching#usage](https://vercel.com/docs/monorepos/remote-caching#usage),
[vercel.com/docs/limits](https://vercel.com/docs/limits) — "Artifacts requests per minute (Free). 100 / 60 / `owner`").
A 208-request run is fine at 40 req/min and fatal at 300. With 14 jobs starting together and
turbo's default `--concurrency` of 10, the emitting window is ~60–90 s wide, so change 1 alone
lands around 140/min — still over. Owner scope also means two concurrent PRs share the same
100, so no per-run budget is ever safe.

Three concrete defects. (a) The `upload-artifact` step in change 2 uploads an **empty artifact**:
the action excludes "files within folders beginning with `.`" and `include-hidden-files: true`
is absent. (b) `--affected` does **not** fall back to the whole graph on any root file — only
`turbo.json`, `turbo.jsonc` and the lockfile. I verified on real commits in this repo that a
`scripts/*.sh`-only change yields **0 packages, 0 tasks**. The plan's safety argument is false
as written. (c) Change 2's 146-request target is reachable by merging the four `^build`-dependent
jobs into one `turbo run build lint typecheck test` (measured: 112, plus format's 34 = 146)
with no artifact plumbing and one install instead of five.

Biggest thing missing: `rharkor/caching-for-turbo` — a GitHub Action that runs a spec-compliant
remote-cache server on localhost backed by the GitHub Actions cache. 604 code-search hits,
v2.5.1 (Jul 2026), used by Rocket.Chat, langfuse, activepieces, remotion. It removes the rate
limit entirely and keeps Vercel for laptops. Alternatively: Pro raises the limit 100× to
10,000/min and the problem evaporates.

---

## 2. What the sources say

### 2.1 Remote-cache request volume — one request per task, no batching

Source-verified in `crates/turborepo-cache/src/http.rs` and `crates/turborepo-api-client/src/lib.rs`
([http.rs](https://github.com/vercel/turborepo/blob/main/crates/turborepo-cache/src/http.rs),
[lib.rs](https://github.com/vercel/turborepo/blob/main/crates/turborepo-api-client/src/lib.rs)).
Every code path is per-hash:

| Operation            | Method | Path                   | When                            |
| -------------------- | ------ | ---------------------- | ------------------------------- |
| `artifact_exists`    | `HEAD` | `/v8/artifacts/{hash}` | dry-run / existence checks      |
| `fetch_artifact`     | `GET`  | `/v8/artifacts/{hash}` | one per task lookup             |
| `put_artifact`       | `PUT`  | `/v8/artifacts/{hash}` | one per task miss               |
| `get_caching_status` | `GET`  | `/v8/artifacts/status` | once per `turbo run` invocation |
| `record_analytics`   | `POST` | `/v8/artifacts/events` | batched, 10 events or 200 ms    |

The only endpoints the client ever builds are `/v8/artifacts/{hash}`, `/v8/artifacts/status`
and `/v8/artifacts/events` (grep of `lib.rs`). **There is no batching of lookups**, even though
the [official OpenAPI spec](https://turborepo.dev/api/remote-cache-spec) defines
`POST /artifacts` ("Query information about multiple artifacts by their hashes… optional for
basic cache functionality but enables optimized cache fetching"). Turbo does not call it. So
"one HTTP lookup per task, hit or miss" is correct and there is no knob that changes it.

Analytics is batched at `BUFFER_THRESHOLD: usize = 10` / `EVENT_TIMEOUT: 200ms`
([turborepo-analytics/src/lib.rs](https://github.com/vercel/turborepo/blob/main/crates/turborepo-analytics/src/lib.rs)),
so a 208-lookup run adds ~21 `POST`s the plan doesn't count.

**429s amplify.** `RETRY_MAX: u32 = 2`, `MIN_SLEEP_TIME_SECS: u64 = 2`, and
`should_retry_status` returns true for `TOO_MANY_REQUESTS`
([retry.rs](https://github.com/vercel/turborepo/blob/main/crates/turborepo-api-client/src/retry.rs)).
Each rate-limited request is retried once, so hitting the limit spends more of it.

**`TURBO_PREFLIGHT` doubles the count.** When `use_preflight` is set, `lib.rs` issues a
`do_preflight` OPTIONS request before each artifact `GET`/`PUT`. Leave it off.

Knobs, assessed:

| Knob                                                           | Effect on request count                                                                                                | Source                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `--cache=local:rw,remote:rw` (default)                         | baseline: 1 lookup/task, 1 PUT/miss                                                                                    | [run#--cache](https://turborepo.dev/docs/reference/run#--cache-options)                        |
| `--cache=local:rw,remote:r` (= `TURBO_REMOTE_CACHE_READ_ONLY`) | removes PUTs only. Lookups unchanged.                                                                                  | ibid.                                                                                          |
| `--cache=local:rw`                                             | zero remote requests, zero cross-machine reuse                                                                         | ibid.                                                                                          |
| `--remote-only`, `--no-cache`                                  | **deprecated**, "will be removed in a future major release. Please use the `--cache` flag instead"                     | ibid.                                                                                          |
| `TURBO_REMOTE_CACHE_SIGNATURE_KEY`                             | none. Signing is client-side HMAC in the `x-artifact-tag` header.                                                      | [system-env-vars](https://turborepo.dev/docs/reference/system-environment-variables)           |
| `TURBO_REMOTE_CACHE_TIMEOUT` / `_UPLOAD_TIMEOUT`               | none on count; next.js sets `--remote-cache-timeout 300` for reliability                                               | ibid.                                                                                          |
| `--concurrency` (default **10**)                               | does not change the total, but caps **in-flight** requests — the only lever that directly targets the per-minute limit | [run#--concurrency](https://turborepo.dev/docs/reference/run#--concurrency-number--percentage) |
| `--dangerously-disable-package-manager-check`                  | irrelevant, as you suspected                                                                                           | —                                                                                              |

**Documented Vercel limits** ([remote-caching#usage](https://vercel.com/docs/monorepos/remote-caching#usage)):

| Plan       | Fair use upload limit | Fair use artifacts request limit |
| ---------- | --------------------- | -------------------------------- |
| Hobby      | 100 GB / month        | **100 / minute**                 |
| Pro        | 1 TB / month          | 10 000 / minute                  |
| Enterprise | 4 TB / month          | 10 000 / minute                  |

Mirrored in [/docs/limits](https://vercel.com/docs/limits) as `Artifacts requests per minute (Free) — 100 — 60 — owner`
and `(Paid) — 10000 — 60 — owner`. Also documented there: `Remote Cache purge requests per minute — 5`.
Artifacts "automatically expire… after 7 days". These are documented, not folklore — but note
the unit is **minute** and the scope is **owner**, i.e. the whole account, across repos and
concurrent runs. There are no 429 or rate-limit issues in `vercel/turborepo`, so the docs are
the only source and they are sufficient.

### 2.2 `--affected`

Official semantics ([run#--affected](https://turborepo.dev/docs/reference/run#--affected)):

> By default, the flag is equivalent to `--filter=...[main...HEAD]`. This considers changes
> between `main` and `HEAD` from Git's perspective.

And on the microsyntax, same page:

> `...` using packages: … Using `...` **before** the package name will select **dependents**
> of the target while using `...` **after** the package name will select **dependencies**.

So **dependents are included**. The plan's claim is correct and this is the property that makes
it safe against breaking an untouched app.

Base/head override is `TURBO_SCM_BASE` / `TURBO_SCM_HEAD`
([system-env-vars](https://turborepo.dev/docs/reference/system-environment-variables)).
Auto-detection in CI ([constructing-ci](https://turborepo.dev/docs/crafting-your-repository/constructing-ci#using---affected-in-github-actions)):

> Turborepo can automatically detect that you're running in GitHub Actions by inspecting
> environment variables set by GitHub, like `GITHUB_BASE_REF`. … While `GITHUB_BASE_REF` works
> well in `pull_request` and `pull_request_target` events, it is not available during regular
> push events. In those cases, we use `GITHUB_EVENT_PATH`.

Shallow-clone behaviour, stated twice:

> The comparison requires everything between base and head to exist in the checkout. If the
> checkout is too shallow, then all packages will be considered changed.

`--affected` combines with `--filter` as AND: "only packages matching **both** constraints are
selected". Task-level granularity is behind `futureFlags.affectedUsingTaskInputs`; by default
"if any file in a package changed, all of its tasks are selected".

**The root-file claim is wrong.** The global-trigger list is two entries
([change_mapper/mod.rs:24](https://github.com/vercel/turborepo/blob/main/crates/turborepo-repository/src/change_mapper/mod.rs)):

```rust
const DEFAULT_GLOBAL_DEPS: &[&str] = ["turbo.json", "turbo.jsonc"].as_slice();
```

Everything else outside a package maps to `WorkspacePackage::root()` unless it matches a
configured `globalDependencies` glob
([change_mapper/package.rs](https://github.com/vercel/turborepo/blob/main/crates/turborepo-repository/src/change_mapper/package.rs)):

```rust
PackageMapping::All(_) => {
    let in_global_deps = self.global_deps_matcher.is_match(cleaned_path.as_str());
    if in_global_deps { PackageMapping::All(AllPackageChangeReason::GlobalDepsChanged { .. }) }
    else { PackageMapping::Packages(vec![(WorkspacePackage::root(), ..)]) }
}
```

`turbo.json` in this repo declares **no `globalDependencies`**. Measured on real commits here
(`TURBO_SCM_BASE=$c^ TURBO_SCM_HEAD=$c turbo run lint typecheck test build --affected --dry=json`):

| commit contents                                                              | packages | tasks with a command |
| ---------------------------------------------------------------------------- | -------- | -------------------- |
| `scripts/dev.sh scripts/infra-up.sh scripts/preview.sh scripts/resolve-*.ts` | **0**    | **0**                |
| `scripts/link-agent-docs.sh`                                                 | **0**    | **0**                |
| `bank.paths.json`                                                            | **0**    | **0**                |
| `docs/adr/*.md docs/agents/domain.md`                                        | **0**    | **0**                |
| `.github/workflows/ci.yml` + root `package.json`                             | 35       | 112                  |

The last row only reaches 35 because turbo 2.7.5 still has root `package.json` in the trigger
list. [PR #12469](https://github.com/vercel/turborepo/pull/12469) (merged 2026-03-27) removed it:

> Removes `package.json` from the hardcoded `DEFAULT_GLOBAL_DEPS` list that triggers
> all-packages-affected. … Root `package.json` is not part of the global hash when a lockfile
> exists (the normal case). … `turbo.json` / `turbo.jsonc` remain global triggers … User-configured
> `globalDependencies` still work — users can add `package.json` there to restore the old behavior.

So on upgrade past ~2.8 that row also collapses. The fix is `globalDependencies`, documented as:
"A list of globs that you want to include in all task hashes. **If any file matching these globs
changes, all tasks will miss cache.**"
([configuration#globaldependencies](https://turborepo.dev/docs/reference/configuration#globaldependencies)).

Related fixes, all closed, all indicating `--affected` has been actively debugged:
[#12900](https://github.com/vercel/turborepo/pull/12900) include lockfile-changed packages,
[#12722](https://github.com/vercel/turborepo/pull/12722) respect SCM env vars in `query affected`,
[#12543](https://github.com/vercel/turborepo/pull/12543) allow `--affected` + `--filter`,
[#13790](https://github.com/vercel/turborepo/issues/13790) commandless tasks never reported
affected, [#13885](https://github.com/vercel/turborepo/pull/13885) adds `--base`/`--head` flags,
[#12650](https://github.com/vercel/turborepo/issues/12650) `affected` failing to resolve the main
branch in GitHub Actions. This repo is on **2.7.5**; latest is **2.10.13** (2026-09-14).

### 2.3 Official CI guidance

[guides/ci-vendors/github-actions](https://turborepo.dev/docs/guides/ci-vendors/github-actions)
([source](https://github.com/vercel/turborepo/blob/main/apps/docs/content/docs/guides/ci-vendors/github-actions.mdx)):
**one** job, `name: Build and Test`, `timeout-minutes: 15`, `runs-on: ubuntu-latest`,
`actions/checkout@v4` with `fetch-depth: 2`, then `pnpm install` → `pnpm build` → `pnpm test`.
No `--affected`, no `turbo-ignore`.

The same page has a section titled **"Remote Caching with GitHub actions/cache"** presenting this
as a supported option:

```yaml
- name: Cache turbo build setup
  uses: actions/cache@v4
  with:
    path: .turbo
    key: ${{ runner.os }}-turbo-${{ github.sha }}
    restore-keys: |
      ${{ runner.os }}-turbo-
```

It also documents two auth paths for Vercel: OIDC via
[`vercel/setup-turborepo-remote-cache-action`](https://github.com/vercel/setup-turborepo-remote-cache-action)
(v1.1.0, "recommended") or a PAT in `TURBO_TOKEN` + `TURBO_TEAM`.

[constructing-ci#best-practices](https://turborepo.dev/docs/crafting-your-repository/constructing-ci#best-practices)
is explicit about topology:

> For example, your CI could run these two commands to quickly handle quality checks and build
> your target application:
>
> - `turbo run lint check-types test`: Run quality checks for your entire repository. Any
>   packages that haven't changed will hit cache.
> - `turbo build --filter=web`: Build the `web` package…

Also from the same page: pin global `turbo` to the major version in `package.json`; prefer
`turbo run <task>` over `turbo <task>` to avoid future subcommand collisions.

**`turbo-ignore` is deprecated.** [reference/turbo-ignore](https://turborepo.dev/docs/reference/turbo-ignore):

> `turbo-ignore` is deprecated and will no longer receive updates. Use `turbo query affected`
> instead, which provides more precise task-level change detection.

The replacement for skipping **whole jobs** — including the install step — is
`turbo query affected --exit-code`, which "exits with code `1` when affected results are found,
`0` when nothing is affected, or `2` on errors"
([guides/skipping-tasks](https://turborepo.dev/docs/guides/skipping-tasks)). The plan doesn't use
this, and it is the only lever that removes the `pnpm install` cost as well as the requests.

### 2.4 Caching tiers — does the local cache actually absorb remote lookups?

Yes, source-verified. `CacheMultiplexer::fetch` reads local first and **returns before touching
the network** on a local hit
([multiplexer.rs](https://github.com/vercel/turborepo/blob/main/crates/turborepo-cache/src/multiplexer.rs)):

```rust
if self.cache_config.local.read && let Some(fs) = &self.fs {
    let response = tokio::task::spawn_blocking(move || fs.fetch(&anchor, &key)).await?;
    if let response @ Ok(Some(_)) = response { return response; }
    // Ok(None) or Err: fall through to the remote cache
}
```

`exists` has the same shape. Two consequences the plan gets right and one it doesn't state:
sharing `.turbo/cache` genuinely eliminates remote lookups (right); sharing `dist/` would not,
because nothing inspects output presence (right); and **a remote hit is written into the local
cache**, so the artifact from the build job contains all 24 build entries whether they hit or
missed:

```rust
if let Ok(Some((hit_metadata, files, body))) = http.fetch_with_archive(key).await {
    let _ = { /* … */ fs.put_archive(&anchor, &key, &files, &body, hit_metadata.time_saved) };
```

That last point also disposes of the "drift" objection. Turbo cache entries are addressed by a
task hash that is a pure function of inputs, and the local store is populated _from_ the remote
one. There is no write path that makes two stores disagree about the same hash. The real risks
with `actions/cache` are different and concrete (§3).

**`upload-artifact` of `.turbo/cache` — the plan's YAML is broken.** The action's README:

> By default, hidden files are ignored by this action to avoid unintentionally uploading
> sensitive information. … Hidden files are defined as any file beginning with `.` **or files
> within folders beginning with `.`**.

`.turbo/cache/*.tar.zst` are files within a folder beginning with `.`. Naming the path explicitly
does not help — [actions/upload-artifact#614](https://github.com/actions/upload-artifact/issues/614)
(open): "Even explicitly named files are not uploaded." `include-hidden-files: true` is required.
`Rocket.Chat` — the only repo I found doing this in the wild — sets it (§3).

**GitHub Actions cache bounds** ([dependency-caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)):
10 GB default per repo (raisable, billed), 7-day eviction of unaccessed entries, LRU by last
access when full, and "The cache eviction process may cause cache thrashing". Scoping is the
sharp edge:

> Workflow runs can restore caches created in either the current branch or the default branch…
> Workflow runs cannot restore caches created for child branches or sibling branches.

> When a cache is created by a workflow run triggered on a pull request, the cache is created for
> the merge ref (`refs/pull/.../merge`)… It cannot be restored by the base branch or other pull
> requests targeting that base branch.

Rate limits ([actions/reference/limits](https://docs.github.com/en/actions/reference/limits#existing-system-limits)):
**200 uploads / min**, 1500 downloads / min, per repository, not raisable.

### 2.5 Self-hosted and alternative remote caches

Turborepo documents the protocol and ships a spec
([core-concepts/remote-caching#remote-cache-api](https://turborepo.dev/docs/core-concepts/remote-caching#remote-cache-api)):

> A Remote Cache can be implemented by any HTTP server that meets Turborepo's Remote Caching
> API specification. … You can also self-host your own Remote Cache and log into it using the
> `--manual` flag… **At this time, all versions of `turbo` are compatible with the `v8` endpoints.**

Spec: [turborepo.dev/api/remote-cache-spec](https://turborepo.dev/api/remote-cache-spec) (OpenAPI
3.0.3). Six endpoints; `GET /artifacts/{hash}`, `PUT`, `HEAD`, `GET /artifacts/status`,
`POST /artifacts/events`, `POST /artifacts`.

| Implementation                                                                                                                   | Status                                                                                                                                                                                                                     | Protocol coverage                                                                                                                                                             | Setup shape                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`rharkor/caching-for-turbo`](https://github.com/rharkor/caching-for-turbo)                                                      | **healthy** — v2.5.1 (2026-07-25), 211★, 1 real open issue, MIT                                                                                                                                                            | `PUT`/`GET`(+auto `HEAD`)/`status`; **no** `events`, **no** batch `POST` — turbo tolerates both                                                                               | one `uses:` step. Spawns a detached Fastify server, exports `TURBO_API=http://localhost:<port>`, `TURBO_TOKEN=turbogha`, `TURBO_TEAM=turbogha`. Backends: GitHub Actions cache (default) or S3/R2/MinIO.                                                                                                                                                        |
| [`brunojppb/turbo-cache-server`](https://github.com/brunojppb/turbo-cache-server)                                                | **healthy** — 4.0.18 (2026-09-08), 220★, Rust/actix. Officially name-checked.                                                                                                                                              | **all six**, explicit `HEAD`                                                                                                                                                  | GitHub Action _or_ `ghcr.io` image. S3-compatible only (S3, R2, RustFS). Auth off unless `TURBO_TOKEN` set.                                                                                                                                                                                                                                                     |
| [`ducktors/turborepo-remote-cache`](https://github.com/ducktors/turborepo-remote-cache)                                          | **healthy** — v2.12.3 (2026-09-02), 1 485★, 47 contributors. Officially name-checked.                                                                                                                                      | `GET`/`HEAD`/`PUT`/`status`/`events`; no batch `POST`                                                                                                                         | Docker / `npx` / Vercel / Lambda / Cloud Run. S3, GCS, Azure Blob, local. JWT or static auth, CDN read-redirect. Uploads buffered in memory (`BODY_LIMIT`, 100 MB default). **No GC** ([#433](https://github.com/ducktors/turborepo-remote-cache/issues/433) open). Needs `TURBO_REMOTE_CACHE_SIGNATURE_KEY` set _server-side_ for signed artifacts to persist. |
| [`AdiRishi/turborepo-remote-cache-cloudflare`](https://github.com/AdiRishi/turborepo-remote-cache-cloudflare)                    | v4.0.0 (2026-01), 238★, last commit 2026-06. Lumpy cadence.                                                                                                                                                                | correct `x-artifact-tag` round-trip; `GET`/`HEAD` via Hono                                                                                                                    | `wrangler deploy` + R2 bucket. Cron-based expiry built in (`BUCKET_OBJECT_EXPIRATION_HOURS: 720`).                                                                                                                                                                                                                                                              |
| [`Tapico/tapico-turborepo-remote-cache`](https://github.com/Tapico/tapico-turborepo-remote-cache)                                | **dead** — last substantive merge 2022-02, last release v0.0.8 (2021-12). Not archived, still linked from turbo's docs.                                                                                                    | `GET`/`POST`/`PUT` only. **No `HEAD`, no `status`, no `events`.** HMAC signing [unimplemented since 2022](https://github.com/Tapico/tapico-turborepo-remote-cache/issues/21). | avoid                                                                                                                                                                                                                                                                                                                                                           |
| `turbogha` = [`dtinth/setup-github-actions-caching-for-turbo`](https://github.com/dtinth/setup-github-actions-caching-for-turbo) | **dead, and says so**: "This action is no longer actively maintained, and there have been breaking changes to the underlying API that makes this action no longer work." Its README points at `rharkor/caching-for-turbo`. | —                                                                                                                                                                             | avoid                                                                                                                                                                                                                                                                                                                                                           |

`rharkor/caching-for-turbo` detail, since it's the direct answer to the rate limit:

```yaml
- uses: rharkor/caching-for-turbo@v2.5.1 # README examples still pin the stale v2.3.12
  with:
    server-port: 0 # 0 = ephemeral; fixes EADDRINUSE on shared runners (#917)
    use-relative-cache-path: true # needed for cross-OS cache reuse (#992)
- run: pnpm turbo run build lint typecheck test
```

Caveats worth knowing before adopting: it inherits GitHub's cache scoping, so PRs warm from
`main` but never from each other or back into `main`; the `github` provider cannot delete, so
`max-age`/`max-size` are no-ops there and you live with the 10 GB LRU; signature keys were broken
until v2.5.1 ([#1048](https://github.com/rharkor/caching-for-turbo/issues/1048) — empty
`restoreKeys` plus `/` in base64 tags breaking temp filenames); and its env gate reads only the
legacy `ACTIONS_CACHE_URL`, never `ACTIONS_RESULTS_URL`, so if a runner stops exporting the
legacy var it silently degrades to a job-local filesystem cache while still logging "saved".

### 2.6 Job topology

Official docs say one job, several tasks in one command (§2.3). The wild says otherwise — see §3.
Measured on this repo:

| topology                                                                | remote lookups     | notes                                                                                          |
| ----------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| today: 5 separate turbo jobs + postinstall in 11 jobs                   | **428**            | matches the ~440 observed                                                                      |
| today minus postinstall                                                 | **208**            | `^build` resolved 4× redundantly (24 + 20 + 22 + 20 = 86 build lookups for 24 distinct builds) |
| `turbo run build lint typecheck test` in one job, + `format` separately | **112 + 34 = 146** | identical to change 2's target, no artifact plumbing, 2 installs not 5                         |
| `turbo run build lint typecheck test format` in one job                 | **146**            | one install                                                                                    |

The 14-job fan-out is not fighting turbo's correctness model — turbo is happy either way — but it
is fighting the rate limit twice over: it duplicates `^build` lookups across jobs, and it
multiplies peak in-flight requests by the job count (14 × default `--concurrency` 10).

### 2.7 Other levers, sourced

- `--continue` default is `never`; options are `never`, `dependencies-successful`, `always`
  ([run#--continue](https://turborepo.dev/docs/reference/run#--continue)). homarr uses
  `--continue=dependencies-successful`, which is the right value for a quality gate that should
  report all failures without running tasks whose deps failed.
- `--summarize` writes "a JSON file in `.turbo/runs` containing metadata about the run, including:
  Affected packages; Executed tasks (including timings/hashes); All files in cached artifacts"
  ([run#--summarize](https://turborepo.dev/docs/reference/run#--summarize)). next.js uploads
  `.turbo/runs` as an artifact. This is how to measure the next iteration instead of estimating.
- `actions/checkout` depth: official GH Actions example uses `fetch-depth: 2`; `--affected` docs
  recommend `--filter=blob:none --depth=0`; `fetch-depth: 0` is what `vercel/turborepo`, homarr
  and midday's staging job use. Anything shallower silently means "all packages changed".
- `TURBO_TELEMETRY_DISABLED` — already set in this repo's workflow. Confirmed as a documented
  variable.
- `packageManager` pinning: already done (`pnpm@10.15.1`), and `pnpm/action-setup@v4` reads it.
  Official guidance additionally says to pin global `turbo` to the major in `package.json`.
- `turbo prune` for Docker ([reference/prune](https://turborepo.dev/docs/reference/prune)); note
  "By default, `turbo prune` does not copy `globalDependencies` files into the pruned output" —
  relevant if §5.3 is adopted and `scripts/extract-app.sh` depends on pruning.
- Larger/alternative runners are mainstream: `ubuntu-latest-16-core-arm-oss` (next.js),
  WarpBuild (trigger.dev), Blacksmith (midday), Depot (unkey, openstatus).
- pnpm store caching: `actions/setup-node` `cache: "pnpm"` is already in this repo's setup
  action. next.js's key carries a warning worth heeding: `key: pnpm-store-root-v1-${{ hashFiles('pnpm-lock.yaml') }}`
  with "Do not use restore-keys since it leads to indefinite growth of the cache."

---

## 3. Prevailing practice

15 public Turborepo monorepos, read from their actual workflow files.

| repo                          | cache strategy                                                                                                                                            | job topology                                                                                                     | change detection                                                                                   | workflow                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **vercel/turborepo**          | Vercel remote via OIDC; `TURBO_CACHE: … 'remote:rw' \|\| 'local:rw'` for forks. `actions/cache` for pnpm store + Cargo only. **Nothing caches `.turbo`.** | fan-out by concern; `lint.yml` 5 jobs, test matrices 3 OS × shards                                               | **`--affected`**, `fetch-depth: 0`                                                                 | [lint.yml](https://raw.githubusercontent.com/vercel/turborepo/main/.github/workflows/lint.yml)                         |
| **vercel/next.js**            | `TURBO_CACHE: 'local:rw,remote:rw'` + OIDC action (`continue-on-error: true`). pnpm store only, no restore-keys. `.turbo/runs` uploaded as artifact.      | **40 jobs** over one reusable job                                                                                | custom `scripts/run-for-change.mjs`                                                                | [build_reusable.yml](https://raw.githubusercontent.com/vercel/next.js/canary/.github/workflows/build_reusable.yml)     |
| **calcom/cal.com**            | Vercel remote **and** an `actions/cache` bundle that includes `**/.turbo/**` alongside `.next`/`dist`, no restore-keys                                    | **20 top-level jobs** + `required` aggregator                                                                    | `dorny/paths-filter@v3`                                                                            | [cache-build/action.yml](https://raw.githubusercontent.com/calcom/cal.com/main/.github/actions/cache-build/action.yml) |
| **triggerdotdev/trigger.dev** | `WarpBuilds/cache@v2` on `node_modules/.cache/turbo`, SHA key + prefix restore-keys. No `TURBO_TOKEN`.                                                    | **13 jobs** + aggregator; 24 test shards                                                                         | `dorny/paths-filter@v4`, 7 groups                                                                  | [typecheck.yml](https://raw.githubusercontent.com/triggerdotdev/trigger.dev/main/.github/workflows/typecheck.yml)      |
| **midday-ai/midday**          | Vercel remote + Blacksmith `stickydisk` for `node_modules`                                                                                                | 9 jobs: `detect-changes` → **one `validate` job running 4 turbo tasks** → 5 deploys                              | `--affected` **and** `--dry-run=json` for job gating; `TURBO_SCM_BASE: ${{ github.event.before }}` | [production.yml](https://raw.githubusercontent.com/midday-ai/midday/main/.github/workflows/production.yml)             |
| **homarr-labs/homarr**        | **self-hosted** remote (`TURBO_API` + `TURBO_TOKEN` + `TURBO_REMOTE_CACHE_SIGNATURE_KEY`)                                                                 | **one job**: `pnpm turbo run lint typecheck build --affected --continue=dependencies-successful --concurrency=2` | `--affected` with a full base fallback chain                                                       | [ci.yml](https://raw.githubusercontent.com/homarr-labs/homarr/dev/.github/workflows/ci.yml)                            |
| **RocketChat/Rocket.Chat**    | `rharkor/caching-for-turbo` **plus** `upload-artifact` of `.turbo/cache` with `include-hidden-files: true`                                                | multi-job                                                                                                        | —                                                                                                  | [ci.yml](https://raw.githubusercontent.com/RocketChat/Rocket.Chat/develop/.github/workflows/ci.yml)                    |
| **t3-oss/create-t3-turbo**    | Vercel remote only. Zero `actions/cache`.                                                                                                                 | 3 jobs (lint, format, typecheck), no `needs`                                                                     | none                                                                                               | [ci.yml](https://raw.githubusercontent.com/t3-oss/create-t3-turbo/main/.github/workflows/ci.yml)                       |
| **openstatusHQ/openstatus**   | Vercel remote only                                                                                                                                        | `check.yml` 1 job / 3 scripts; `test.yml` 6-leg `--filter` matrix + aggregator                                   | none                                                                                               | [check.yml](https://raw.githubusercontent.com/openstatusHQ/openstatus/main/.github/workflows/check.yml)                |
| **typehero/typehero**         | Vercel remote + `actions/cache` on **tsbuildinfo**, not `.turbo`                                                                                          | 4 jobs                                                                                                           | none                                                                                               | [quality.yml](https://raw.githubusercontent.com/typehero/typehero/main/.github/workflows/quality.yml)                  |
| **makeswift/makeswift**       | Vercel remote in `ci.yml` only; lint/prettier workflows omit the env and run cold                                                                         | 1 job each                                                                                                       | none                                                                                               | [ci.yml](https://raw.githubusercontent.com/makeswift/makeswift/main/.github/workflows/ci.yml)                          |
| **shadcn-ui/ui**              | **nothing turbo-related**; pnpm store only. `build:packages` re-runs from scratch in each job.                                                            | 15 jobs, no `needs`                                                                                              | none                                                                                               | [code-check.yml](https://raw.githubusercontent.com/shadcn-ui/ui/main/.github/workflows/code-check.yml)                 |
| **formbricks/formbricks**     | **nothing, deliberately** — measured and documented                                                                                                       | 9 jobs + `required`                                                                                              | none                                                                                               | [pr.yml](https://raw.githubusercontent.com/formbricks/formbricks/main/.github/workflows/pr.yml)                        |
| **dubinc/dub**                | nothing (Playwright browsers only)                                                                                                                        | 1 job per workflow                                                                                               | none                                                                                               | [prettier.yaml](https://raw.githubusercontent.com/dubinc/dub/main/.github/workflows/prettier.yaml)                     |
| **documenso/documenso**       | nothing; `npm ci` every run                                                                                                                               | 2 jobs                                                                                                           | none                                                                                               | [ci.yml](https://raw.githubusercontent.com/documenso/documenso/main/.github/workflows/ci.yml)                          |
| **unkeyed/unkey**             | CI has **moved off GitHub Actions** to Depot (`.depot/workflows/`)                                                                                        | 8 jobs                                                                                                           | path-filter job                                                                                    | [.depot/workflows/pr.yaml](https://raw.githubusercontent.com/unkeyed/unkey/main/.depot/workflows/pr.yaml)              |

`twentyhq/twenty` is Nx, not turbo. `vercel/commerce` is not a monorepo.

**Prevalence**, from `gh api search/code` `total_count` (whole index, `path:.github/workflows`
unless noted):

| query                                                      | count     | read                                                |
| ---------------------------------------------------------- | --------- | --------------------------------------------------- |
| `"TURBO_TOKEN"`                                            | **5 792** | remote cache is the dominant pattern by ~8–15×      |
| `".turbo/cache"`                                           | 379       | real population of "cache the turbo dir"            |
| `"node_modules/.cache/turbo"`                              | 323       | the turbo ≤1.x spelling; ~700 total across both     |
| `"rharkor/caching-for-turbo"` (all paths)                  | **604**   | comparable in scale to hand-rolled `.turbo` caching |
| `"TURBO_SCM_BASE"`                                         | 342       |                                                     |
| `"turbo run" "--affected"`                                 | 291       | `--affected` is rare                                |
| `"vercel/setup-turborepo-remote-cache-action"` (all paths) | 201       | new, OIDC                                           |
| `"turbo-ignore"`                                           | 75        | very rare in workflows                              |

**Dominant pattern:** Vercel (or self-hosted) remote cache as the only cache, with `actions/cache`
reserved for the package-manager store. `actions/cache` on `.turbo/cache` is **not** dominant —
zero of the 15 use it as their primary strategy. When people do want the GitHub cache as the turbo
backend, the modern way is a proxy action (`rharkor`, WarpBuilds/Depot/Blacksmith equivalents),
not `actions/cache` on `.turbo`.

Community key convention, where `actions/cache` is used: `turbo-${{ runner.os }}-${{ github.sha }}`

- `restore-keys: turbo-${{ runner.os }}-` (identical in tamagui, mastra, vercel/ai). SHA in the key
  makes writes append-only, which is the [actions/cache#106](https://github.com/actions/cache/issues/106)
  workaround — and why both `vercel/turborepo` and cal.com ship a workflow that deletes a branch's
  caches on PR close.

**`upload-artifact` of `.turbo/cache` is vanishingly rare.** I found exactly one real instance
(Rocket.Chat, above), and it sits _alongside_ `rharkor/caching-for-turbo` — intra-run handoff from
a cheap build job to expensive consumers, not a cache tier.

Two warnings from real workflows that bear directly on this plan. formbricks:

```yaml
# NOTE: no build cache here. We measured caching Next's .next/cache
# incremental compiler cache too — warm build (4m17s) was no faster than
# cold (3m46s) … Build is ~4min regardless; a real reduction needs a Turbo
# cache backend, not local actions/cache.
```

```yaml
# NOTE: Actions caches are branch-scoped and every merge_group run happens on a
# throwaway `gh-readonly-queue/...` branch, so this misses ~always there.
```

This repo triggers on `merge_group`, so the second applies directly to any `actions/cache`-based
tier here. A localhost proxy backed by the Actions cache (`rharkor`) has the same limitation.

---

## 4. Plan review

### Change 1 — drop the postinstall build in CI. **Correct. Do it first.**

`postinstall` runs `turbo run build --filter=./packages/**` in all 11 jobs that use the setup
action, and `lint`/`typecheck`/`test` all declare `dependsOn: ["^build"]` in `turbo.json`, so
turbo resolves the builds it needs anyway. The other six jobs read no `dist/`. The `−220` figure
follows from 20 build tasks × 11 jobs. No source contradicts this; it is purely a repo fact and
it checks out. Already applied in `package.json` (`([ -n "$CI" ] || turbo run build …)`).

One thing to verify: the plan's stated reason for the `$CI` guard over `--ignore-scripts` is that
esbuild's own postinstall must still run. That reasoning holds.

### Change 2 — `upload-artifact` of `.turbo/cache`. **Premise right, implementation broken, and there's a simpler route to the same number.**

Right, and source-verified:

- Sharing `dist/` would not help. `CacheMultiplexer` never inspects output presence; it decides
  from the task hash.
- `.turbo/cache` is the thing to share, and a local hit short-circuits the remote request
  entirely (`multiplexer.rs`, quoted in §2.4).
- The build job's cache contains all 24 build entries even on a fully warm remote cache, because
  remote hits are written into the local store via `fs.put_archive`.
- `upload-artifact` genuinely is intra-run fan-out rather than a second durable store, and one
  real repo (Rocket.Chat) does exactly this.

Broken:

- **Missing `include-hidden-files: true`.** Per the action's README, "Hidden files are defined as
  any file beginning with `.` or files within folders beginning with `.`", and
  [#614](https://github.com/actions/upload-artifact/issues/614) confirms explicit naming does not
  override it. As written the artifact uploads empty, the downstream `download-artifact` succeeds
  with nothing, and the three jobs silently fall through to Vercel at the full request count. The
  `continue-on-error: true` on the download hides it. This would have looked like "the change
  didn't help much".
- The comment "Download before setup so anything during install reads it too" is vestigial once
  change 1 lands — nothing during install reads the cache any more.

Simpler route to the same number: merge the four `^build`-dependent jobs.

|                                                           | requests           | installs | peak in-flight | wall clock                                            |
| --------------------------------------------------------- | ------------------ | -------- | -------------- | ----------------------------------------------------- |
| change 2 as written                                       | 146                | 5        | up to 50       | `build` + max(lint, typecheck, test)                  |
| `turbo run build lint typecheck test` + separate `format` | **146** (112 + 34) | 2        | up to 20       | `build` + (lint ∪ typecheck ∪ test) on one 4-vCPU box |

Identical request count. Fewer moving parts, fewer installs, and a much flatter request rate —
which, per §1, is the constraint that actually binds. The cost is real: you give up ~3 runners'
worth of parallelism on a cold cache, and you lose per-task granularity in the Checks UI. That is
a legitimate reason to prefer change 2, and fan-out is what most large repos do (§3) even though
the official docs show one job. Pick on that tradeoff, not on request count — they tie.

### Change 3 — `--affected` on pull requests. **Right lever. The safety argument is false and needs `globalDependencies` before this is trustworthy.**

Right:

- `--affected` ≡ `--filter=...[base...HEAD]` and `...` before the selector means **dependents**,
  so a PR cannot break an untouched app without that app entering scope. Verified in the docs
  and by the 3-package result for a `packages/features/billing` change.
- Setting `TURBO_SCM_BASE` explicitly rather than relying on `GITHUB_BASE_REF` matches homarr and
  midday, and sidesteps [#12650](https://github.com/vercel/turborepo/issues/12650).
- `fetch-depth: 0` is required; without it "all packages will be considered changed" (docs, twice).
- Restricting to `pull_request` so `main` keeps the cache populated is sound.
- Not adding `AFFECTED_FLAG` to `globalEnv` is correct — it changes scope, not inputs, and
  declaring it would partition the cache. (Cross-check: it is not in `globalPassThroughEnv`
  either, and doesn't need to be; the shell expands it before turbo sees it.)

Wrong:

> That fallback is what makes it safe: a change outside any package invalidates the whole graph
> rather than silently skipping it.

It does not. `DEFAULT_GLOBAL_DEPS` is `["turbo.json", "turbo.jsonc"]`, plus lockfile changes
handled separately. Measured on this repo: a `scripts/*.sh`-only commit yields **0 packages,
0 tasks**. The `turbo.json` → 35 observation the plan generalised from is the single special case.
Worse, the 35 for root `package.json` disappears on upgrade past ~2.8
([#12469](https://github.com/vercel/turborepo/pull/12469)), so the plan's evidence base degrades
silently on a version bump.

Concrete exposure in this repo: `scripts/test.sh` is the entrypoint for every backend and frontend
suite; `.prettierignore` decides what `format` checks; `.nvmrc` sets the Node version for every
task. A PR touching only those runs zero turbo tasks under `--affected` and goes green. The fix is
§5.3.

The arg-passing analysis is correct and already implemented: `lint` and `format` end in
`-- --cache --cache-location …`, so `$AFFECTED_FLAG` must sit at the turbo call site. `test.sh`
forwards `"$@"` (`exec turbo run "$task" --concurrency="${TEST_CONCURRENCY:-2}" "$@"`), so it would
have worked either way; threading all five uniformly is the right call.

Two gaps in the wiring as it stands in `ci.yml`:

- `merge_group` gets `AFFECTED_FLAG: ''`, so the merge queue re-runs the full 208. Correct for
  safety, but it means the peak-rate problem returns on every merge. homarr's base chain
  (`… || github.event.merge_group.base_sha || github.event.before || 'HEAD~1'`) is the pattern if
  you later want `--affected` there too.
- `format` has `fetch-depth: 0` but no `needs`, which is right; `boundaries`, `test-policy`,
  `deps-lint`, `deps-check`, `duplication`, `audit` don't need `fetch-depth: 0` and don't have it.
  Consistent.

### Open question 1 — drop read-only remote on downstream jobs? **Yes, drop it. The plan's reasoning holds, and the flag targets the wrong half anyway.**

`--cache=local:rw,remote:r` / `TURBO_REMOTE_CACHE_READ_ONLY` suppress **PUTs only**; the per-task
`GET` lookup, which is the entire 208, is unaffected
([run#--cache](https://turborepo.dev/docs/reference/run#--cache-options),
[system-env-vars](https://turborepo.dev/docs/reference/system-environment-variables)). On a warm
cache there are almost no PUTs to suppress. On a cold one you would save PUTs and forfeit all
cross-run and laptop reuse of `.cache/.eslintcache` / `.cache/tsbuildinfo.json` — entries that only
CI ever produces at scale. The plan's assessment is correct.

Worth knowing for a different reason: `vercel/turborepo` itself uses this axis for fork safety, not
for volume — `TURBO_CACHE: ${{ … == github.repository && 'remote:rw' || 'local:rw' }}`. That is a
better use of the knob if this repo ever takes fork PRs, since a fork can't read `secrets.TURBO_TOKEN`
and every lookup would fail.

### Open question 2 — `--affected` on `build` too, or always build the full graph? **Use it on `build` too. The full-graph build is not a backstop.**

Dependents are included, so nothing an app depends on can change without that app entering scope.
A full-graph build buys nothing against the failure mode you're worried about, and it costs 24
lookups plus the build time on every PR.

It also doesn't cover the real hole. A full-graph `build` would not have caught the
`scripts/test.sh` case either, because `build` doesn't read it. The backstop you want is
`globalDependencies` (§5.3) plus the existing full run on `main` and in the merge queue.

---

## 5. What to do instead / additionally

Ordered by impact on the 429s.

### 5.1 Reframe the budget as requests per minute, then decide

100/min, owner-scoped. Do the arithmetic in that unit before spending more design effort:

| state                                | requests | plausible emit window | peak rate | over 100/min? |
| ------------------------------------ | -------- | --------------------- | --------- | ------------- |
| today                                | ~428     | ~90 s                 | ~285/min  | yes           |
| + change 1                           | 208      | ~90 s                 | ~140/min  | **yes**       |
| + change 2 or job merge              | 146      | ~90 s                 | ~100/min  | borderline    |
| + `--affected` on a typical PR       | ~30      | —                     | —         | no            |
| two concurrent PRs, any of the above | ×2       | —                     | ×2        | —             |

Change 1 alone probably does not clear it. The plan's per-run accounting cannot show this.
Measure it directly: `--summarize` writes timings and hashes to `.turbo/runs`
([run#--summarize](https://turborepo.dev/docs/reference/run#--summarize)); upload that as an
artifact the way next.js does and you get the real emit window instead of an estimate.

### 5.2 Decide between Pro and a second backend, and say so explicitly

The constraint "Vercel stays the single durable cache" is what forces all the rest of the plan.
Two ways out, both cheap:

- **Pro** — 10 000/min, a 100× headroom increase
  ([remote-caching#usage](https://vercel.com/docs/monorepos/remote-caching#usage)). The whole
  problem disappears and changes 2 and 3 become optional optimisations rather than necessities.
- **`rharkor/caching-for-turbo@v2.5.1`** — CI reads and writes the GitHub Actions cache through a
  localhost server that speaks the documented `v8` protocol. One `uses:` step, no infrastructure.
  604 code-search hits; Rocket.Chat, langfuse, activepieces, remotion. Two honest costs: it
  replaces `TURBO_API` for the job, so CI stops populating Vercel and the laptop↔CI sharing you
  adopted remote caching for goes away for CI-produced entries; and it inherits GitHub's
  PR-merge-ref scoping, so PRs warm from `main` but never from each other, and `merge_group` runs
  on throwaway branches miss ~always. If laptop↔CI matters more than CI speed, prefer Pro. If you
  want both, `provider: s3` against R2 with a bucket both CI and laptops can reach is the shape
  `brunojppb/turbo-cache-server` and `ducktors/turborepo-remote-cache` also serve.

Do not build a bespoke `actions/cache` tier. formbricks measured it and wrote down that it didn't
help, and their merge-queue note applies verbatim here.

### 5.3 Close the `--affected` hole before shipping change 3

Add the root files that change what turbo tasks _do_ to `globalDependencies` in `turbo.json`:

```jsonc
"globalDependencies": [".nvmrc", ".prettierignore", "scripts/test.sh"]
```

Matching any of these returns `PackageMapping::All`, so the graph is in scope
([change_mapper/package.rs](https://github.com/vercel/turborepo/blob/main/crates/turborepo-repository/src/change_mapper/package.rs)).
Price, stated in the docs: "**If any file matching these globs changes, all tasks will miss cache.**"
That is the correct trade for `scripts/test.sh` and `.nvmrc`. Deliberately _not_ on the list:
`knip.jsonc`, `.jscpd.json`, `.syncpackrc.ts`, `.gitleaks.toml`, `bank.paths.json` — those drive
root `pnpm` scripts that never go through turbo and whose jobs are ungated, so they already always
run. Keep the list minimal; every entry is a repo-wide cache buster.

Consider also adding `package.json` to restore the pre-#12469 behaviour before you upgrade turbo,
so the upgrade doesn't silently change scoping.

### 5.4 Fix change 2 or replace it with a job merge

If keeping it:

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: turbo-cache
    path: .turbo/cache
    include-hidden-files: true # without this the artifact is empty
    retention-days: 1
```

and assert non-emptiness rather than trusting `continue-on-error` — `ls .turbo/cache | wc -l`
after download, failing loudly on zero, is enough to stop this regressing.

If replacing it: one job running `turbo run build lint typecheck test --continue=dependencies-successful`,
plus `format` separately, hits the same 146 with two installs, no artifacts, and a quarter of the
peak rate. `--continue=dependencies-successful` preserves the "still report lint/typecheck/test when
the build breaks" property the `if: ${{ !cancelled() }}` guards are there for
([run#--continue](https://turborepo.dev/docs/reference/run#--continue)).

### 5.5 Skip jobs, not just tasks

The official replacement for `turbo-ignore` is `turbo query affected --exit-code`, run "after
you've checked out the repo, but **before** any other work"
([skipping-tasks](https://turborepo.dev/docs/guides/skipping-tasks)). It exits 1 when affected,
0 when not, 2 on error. Gating the four turbo jobs on it removes the `pnpm install` cost, not just
the requests — on a docs-only PR that is the difference between four ~2-minute jobs and four
~15-second jobs. midday does the `--dry-run=json` variant of this for deploy gating.

### 5.6 Upgrade turbo

2.7.5 → 2.10.13. Two reasons beyond the usual: `--affected` has had a long run of fixes
(#12469 root `package.json`, #12543 `--affected` + `--filter`, #12722 SCM env vars in `query affected`,
#12900 lockfile-changed packages, #13790 commandless tasks, #13885 `--base`/`--head`), and #12469 in
particular **changes** `--affected` scoping in a way that makes the plan's `turbo.json → 35`
evidence stop generalising. Better to upgrade and re-measure than to ship against 2.7.5 behaviour.

### 5.7 Smaller, cheap

- Add `--concurrency` to the turbo-heavy jobs if you keep the fan-out. It is the only flag that
  directly bounds in-flight remote requests. homarr runs `--concurrency=2`.
- `--continue=dependencies-successful` on `lint`/`typecheck`/`test` instead of bare `--continue`
  (which is `--continue=always` in effect for the current invocation shape).
- Consider `vercel/setup-turborepo-remote-cache-action@v1.1.0` (OIDC) over the long-lived PAT —
  official, short-lived tokens, revoked in `post-if: always()`. Needs `permissions: id-token: write`
  and `TURBO_TEAM` as a repo variable, both of which you already have.
- Do not enable `TURBO_PREFLIGHT` or `remoteCache.preflight`. It adds an OPTIONS request before
  every artifact request.
- If you ever accept fork PRs, adopt turborepo's own `TURBO_CACHE: … 'remote:rw' || 'local:rw'`
  guard; otherwise every lookup from a fork fails and burns the budget.

---

## 6. Sources

Official Turborepo docs (all on `turborepo.dev`; `turborepo.com` 301s):
[constructing-ci](https://turborepo.dev/docs/crafting-your-repository/constructing-ci) ·
[guides/ci-vendors/github-actions](https://turborepo.dev/docs/guides/ci-vendors/github-actions) ·
[reference/run](https://turborepo.dev/docs/reference/run) ·
[reference/system-environment-variables](https://turborepo.dev/docs/reference/system-environment-variables) ·
[reference/configuration](https://turborepo.dev/docs/reference/configuration) ·
[reference/turbo-ignore](https://turborepo.dev/docs/reference/turbo-ignore) ·
[guides/skipping-tasks](https://turborepo.dev/docs/guides/skipping-tasks) ·
[core-concepts/remote-caching](https://turborepo.dev/docs/core-concepts/remote-caching) ·
[Remote Cache OpenAPI spec](https://turborepo.dev/api/remote-cache-spec).
Docs source read raw from
[`apps/docs/content/docs/`](https://github.com/vercel/turborepo/tree/main/apps/docs/content/docs).

`vercel/turborepo` source:
[`turborepo-cache/src/http.rs`](https://github.com/vercel/turborepo/blob/main/crates/turborepo-cache/src/http.rs) ·
[`turborepo-cache/src/multiplexer.rs`](https://github.com/vercel/turborepo/blob/main/crates/turborepo-cache/src/multiplexer.rs) ·
[`turborepo-api-client/src/lib.rs`](https://github.com/vercel/turborepo/blob/main/crates/turborepo-api-client/src/lib.rs) ·
[`turborepo-api-client/src/retry.rs`](https://github.com/vercel/turborepo/blob/main/crates/turborepo-api-client/src/retry.rs) ·
[`turborepo-api-client/src/analytics.rs`](https://github.com/vercel/turborepo/blob/main/crates/turborepo-api-client/src/analytics.rs) ·
[`turborepo-analytics/src/lib.rs`](https://github.com/vercel/turborepo/blob/main/crates/turborepo-analytics/src/lib.rs) ·
[`turborepo-repository/src/change_mapper/mod.rs`](https://github.com/vercel/turborepo/blob/main/crates/turborepo-repository/src/change_mapper/mod.rs) ·
[`turborepo-repository/src/change_mapper/package.rs`](https://github.com/vercel/turborepo/blob/main/crates/turborepo-repository/src/change_mapper/package.rs).

`vercel/turborepo` issues/PRs:
[#12469](https://github.com/vercel/turborepo/pull/12469) ·
[#12543](https://github.com/vercel/turborepo/pull/12543) ·
[#12650](https://github.com/vercel/turborepo/issues/12650) ·
[#12722](https://github.com/vercel/turborepo/pull/12722) ·
[#12900](https://github.com/vercel/turborepo/pull/12900) ·
[#13790](https://github.com/vercel/turborepo/issues/13790) ·
[#13885](https://github.com/vercel/turborepo/pull/13885) ·
[#12382](https://github.com/vercel/turborepo/pull/12382) (turbo-ignore deprecation).

Vercel docs:
[monorepos/remote-caching](https://vercel.com/docs/monorepos/remote-caching) ·
[limits](https://vercel.com/docs/limits).

GitHub docs:
[dependency-caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) ·
[actions/reference/limits](https://docs.github.com/en/actions/reference/limits#existing-system-limits) ·
[changelog 2025-03-20 cache service v2](https://github.blog/changelog/2025-03-20-notification-of-upcoming-breaking-changes-in-github-actions/) ·
[changelog 2026-09-10 cache-mode](https://github.blog/changelog/2026-09-10-control-github-actions-cache-access-with-cache-mode/) ·
[actions/upload-artifact README](https://github.com/actions/upload-artifact) and
[#614](https://github.com/actions/upload-artifact/issues/614).

Cache implementations:
[rharkor/caching-for-turbo](https://github.com/rharkor/caching-for-turbo)
([#1048](https://github.com/rharkor/caching-for-turbo/issues/1048),
[#992](https://github.com/rharkor/caching-for-turbo/issues/992),
[#944](https://github.com/rharkor/caching-for-turbo/issues/944),
[#917](https://github.com/rharkor/caching-for-turbo/issues/917),
[#370](https://github.com/rharkor/caching-for-turbo/issues/370),
[#260](https://github.com/rharkor/caching-for-turbo/issues/260)) ·
[brunojppb/turbo-cache-server](https://github.com/brunojppb/turbo-cache-server) ·
[ducktors/turborepo-remote-cache](https://github.com/ducktors/turborepo-remote-cache)
([#433](https://github.com/ducktors/turborepo-remote-cache/issues/433),
[#622](https://github.com/ducktors/turborepo-remote-cache/issues/622),
[#679](https://github.com/ducktors/turborepo-remote-cache/issues/679)) ·
[Tapico/tapico-turborepo-remote-cache](https://github.com/Tapico/tapico-turborepo-remote-cache)
([#21](https://github.com/Tapico/tapico-turborepo-remote-cache/issues/21)) ·
[AdiRishi/turborepo-remote-cache-cloudflare](https://github.com/AdiRishi/turborepo-remote-cache-cloudflare) ·
[dtinth/setup-github-actions-caching-for-turbo](https://github.com/dtinth/setup-github-actions-caching-for-turbo) ·
[vercel/setup-turborepo-remote-cache-action](https://github.com/vercel/setup-turborepo-remote-cache-action) ·
[vercel/remote-cache](https://github.com/vercel/remote-cache).

Workflow files: linked inline in §3.

Local measurements (turbo 2.7.5, this repo, read-only `--dry=json`): task counts per root task;
single-job union counts; `--affected` scope for four real commits via `TURBO_SCM_BASE`/`TURBO_SCM_HEAD`.
