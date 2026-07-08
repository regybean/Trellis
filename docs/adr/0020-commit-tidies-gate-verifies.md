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
2. **Gate (`pnpm quality-gate`, once at task end)** — every fail-able check
   (`lint:fix`, `format:fix`, `typecheck`+`build`, `boundaries`, `test:policy`,
   `lint:ws`, `deps:lint`, `gitleaks`, `test`). Run once before opening a PR
   (wired into the worktree workflow), not per commit.
3. **CI** — the same checks, as the hard backstop on every PR.

Two supporting changes make the single gate run legible so a failure doesn't
force a re-run to find the log:

- `scripts/quality-gate.sh` runs all stages in **one pass** (never fail-fast),
  tees everything to `.cache/quality-gate.log`, and prints a per-stage PASS/FAIL
  summary. On failure the agent reads one file and sees exactly what failed.
- Turbo `lint` / `typecheck` / `build` / `test` tasks set
  `"outputLogs": "errors-only"` — successful tasks stay silent, so any terminal
  run surfaces only the failing task.

## Considered and rejected

- **Keep `eslint --fix` on commit.** ESLint is type-aware
  (`recommendedTypeChecked` + `projectService`); on staged files it still
  evaluates un-fixable rules and exits non-zero, which blocks the commit — the
  exact round-trip we're removing. Its only commit-time value is cosmetic
  auto-fixing, which the gate does anyway.
- **A `pre-push` gate.** Guarantees no red branch reaches the remote but mostly
  duplicates CI, adds latency to every push, and traps an agent that wants to
  push WIP for help. The gate stays disciplined (worktree workflow) with CI as
  the backstop; revisit if red branches actually reach the remote.
- **lefthook `glob` alone (previous state).** `glob` only gates _whether_ a
  command runs, not _which files_ it receives — so `pnpm lint:fix` linted (and,
  via the `lint` task's `^build` dep, built) the whole repo on every commit.

## Consequences

- Fixable ESLint issues (import order, etc.) are not auto-fixed per commit; they
  surface at the gate, which mutates and re-stages before the PR.
- The `lint` turbo task still carries `dependsOn: ["^build"]`, and it must. Under
  `moduleResolution: "Bundler"` a cross-package type import resolves via the
  `exports` `types` condition → `./dist/*.d.ts` (there is no `paths` map or source
  condition), and the base tsconfig sets `disableSourceOfProjectReferenceRedirect:
true` — both deliberately consume _built_ `.d.ts`, not source. So type-aware
  ESLint (`projectService`) and `typecheck` genuinely need dependencies built
  first. Dropping `^build` from `lint` is **not** a viable optimization here; it
  would only work with a `paths`/source-condition JIT setup, which this repo does
  not use. Moving `lint` off commit already removed that cost from the hot path.
