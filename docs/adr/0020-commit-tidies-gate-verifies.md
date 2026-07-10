# Commit tidies, the gate verifies: tiered quality checks

Quality checks are split by _when they run_ and _whether they can block_, to keep
an agent from round-tripping on a hook mid-task. Three tiers:

1. **Commit (lefthook pre-commit)** — deterministic, non-blocking auto-fixers on
   the **staged files only**: `prettier --write {staged_files}` (config resolved
   per-file from each package's `package.json` "prettier" key) plus
   `gitleaks protect --staged`. No ESLint, no typecheck, no tests. Prettier can't
   meaningfully fail, so a commit never blocks; secrets are the one thing we
   refuse to let into history. The two commands run in parallel — Prettier writes
   the working tree, gitleaks reads the staged index, and formatting can't add or
   hide a secret.
2. **Gate (`pnpm quality-gate`, once at task end)** — every fail-able check,
   **read-only**: `lint`, `format`, `typecheck`+`build`, `test` (one combined
   `turbo run … --continue`), plus `check:exports`, `boundaries`, `test:policy`,
   `lint:ws`, `deps:lint`, `gitleaks`. Run once before opening a PR (wired into
   the worktree workflow), not per commit. The gate **verifies, it does not
   mutate** — auto-fixing is a separate `pnpm tidy` step (see below).
3. **CI** — the same checks, as the hard backstop on every PR.

### The gate verifies, `pnpm tidy` fixes

The gate itself carries no auto-fixers. Fixing lives in two places:

- **Format** — at commit time (lefthook `prettier --write {staged_files}`), the
  cheap fix that needs no build and can't meaningfully fail.
- **`pnpm tidy`** (`lint:fix && format:fix`) — the on-demand fix step, run before
  the gate (or wired into the worktree flow). `lint:fix` mutates and can't be
  cached, so it stays out of the hot verification path deliberately.

Two reasons the gate is read-only rather than fixing-in-place:

- **Cacheable + parallel.** Auto-fixers mutate, so they're never cached and force
  a sequential spine (two writers can't share files; readers can't overlap
  writers). A read-only gate has no such constraint: the four cacheable turbo
  tasks run in **one `turbo run lint format typecheck test --continue`** so turbo
  parallelises across packages _and_ task types and reuses its cache, and the
  standalone checks run as a parallel background group. On a warm run where one
  package changed the gate is a few seconds; the old fixing-gate paid ~44s of
  uncacheable lint/format every time.
- **It matches this ADR's own thesis** — commit tidies, the gate verifies. A gate
  that also mutated blurred that line.

Two supporting changes make the single gate run legible so a failure doesn't
force a re-run to find the log:

- `scripts/quality-gate.sh` runs every stage (never fail-fast), each into its own
  per-stage log, then concatenates them in a fixed order into
  `.cache/quality-gate.log` and prints a per-stage PASS/FAIL summary. Per-stage
  logs (not a shared tee) keep parallel output from interleaving. On failure the
  agent reads one file and sees exactly what failed.
- Turbo `lint` / `typecheck` / `build` / `test` tasks set
  `"outputLogs": "errors-only"` — successful tasks stay silent, so any terminal
  run surfaces only the failing task.

## Considered and rejected

- **Keep `eslint --fix` on commit.** ESLint is type-aware
  (`recommendedTypeChecked` + `projectService`); on staged files it still
  evaluates un-fixable rules and exits non-zero, which blocks the commit — the
  exact round-trip we're removing. It also needs the `dist` `.d.ts` built first
  (see Consequences), so it can't run cheaply on commit anyway. Its cosmetic
  auto-fixing lives in `pnpm tidy` instead.
- **A gate that auto-fixes (previous state).** The gate used to run `lint:fix` +
  `format:fix` before verifying. Auto-fixers mutate, so they can't be cached and
  force a sequential spine — ~44s of uncacheable lint/format on every run. Moving
  the fix to an on-demand `pnpm tidy` let the gate go fully read-only, cacheable,
  and parallel.
- **A `pre-push` gate.** Guarantees no red branch reaches the remote but mostly
  duplicates CI, adds latency to every push, and traps an agent that wants to
  push WIP for help. The gate stays disciplined (worktree workflow) with CI as
  the backstop; revisit if red branches actually reach the remote.
- **lefthook `glob` alone (previous state).** `glob` only gates _whether_ a
  command runs, not _which files_ it receives — so `pnpm lint:fix` linted (and,
  via the `lint` task's `^build` dep, built) the whole repo on every commit.

## Consequences

- Fixable ESLint issues (import order, etc.) are not auto-fixed per commit, and
  the gate no longer fixes them either — it **fails** on them. The fix is one
  `pnpm tidy` away: run it, re-run the gate (now cache-warm, so seconds). The
  worktree flow runs `tidy` before the gate so this is invisible in practice.
- The gate never mutates the working tree, so it's safe to run repeatedly and its
  result is a pure function of the tree (turbo can cache it).
- The `lint` turbo task still carries `dependsOn: ["^build"]`, and it must. Under
  `moduleResolution: "Bundler"` a cross-package type import resolves via the
  `exports` `types` condition → `./dist/*.d.ts` (there is no `paths` map or source
  condition), and the base tsconfig sets `disableSourceOfProjectReferenceRedirect:
true` — both deliberately consume _built_ `.d.ts`, not source. So type-aware
  ESLint (`projectService`) and `typecheck` genuinely need dependencies built
  first. Dropping `^build` from `lint` is **not** a viable optimization here; it
  would only work with a `paths`/source-condition JIT setup, which this repo does
  not use. Moving `lint` off commit already removed that cost from the hot path.
