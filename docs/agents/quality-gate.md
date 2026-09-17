# Verification: incremental checks and the gate

How code is verified in this repo. Two tiers — cheap per-package checks while you
work, one full gate at the end. Rationale in [ADR 0020](../adr/0020-commit-tidies-gate-verifies.md).

## As you go — per package

After touching a package, run the cached incremental check (seconds):

```bash
pnpm turbo run lint typecheck -F @acme/<pkg>
```

Don't run the full suite or `quality-gate` per commit.

**"Touching a package" includes its tests.** `typecheck` covers `src/tests/**`,
and `vitest run` does not typecheck at all — so a green suite driven directly
says nothing about whether the gate will build. Write a test file, run the check
above. Skip it and a type error in a test sits undetected until the gate pays
minutes to find what this would have found in seconds.

## At the end — the gate

Run `tidy` (auto-fix) first, then the gate **once**:

```bash
pnpm tidy            # lint:fix + format:fix — mutates the tree
pnpm turbo run typecheck  # autofix can change types — cached, seconds
pnpm quality-gate    # read-only verify: build + turbo(lint+format+typecheck) + test
                     # + check:exports + check:imports + check:bank-paths
                     # + check:bank-tokens
                     # + check:adrs + check:portable + boundaries
                     # + lint:ws + deps:lint + test:policy + gitleaks
```

The gate is **read-only** — it verifies, it never fixes. So `tidy` must run first,
or the gate **fails** on fixable lint/format issues.

**`tidy` is not purely risk-reducing, which is why a `typecheck` follows it.** It
mutates the tree, and an autofix that rewrites an expression can change that
expression's type — `unicorn/no-useless-undefined` turning
`Promise.resolve(undefined)` into `Promise.resolve()` narrows the result to
`Promise<void>` and breaks a declared return type. So `tidy` can hand the gate a
type error that was not there before, and the gate is where you find out, minutes
later. The interposed `typecheck` is cache-warm and costs seconds.

The gate runs every stage in
parallel and writes `logs/quality-gate.log` with a per-stage PASS/FAIL summary,
each stage's own duration, and the slowest stage. Stage durations overlap (only
`build` runs serial-before the rest), so read the column to find the long pole —
not to sum it against `elapsed`.
On failure, read that file for the failing stage, fix (or re-`tidy`), and re-run
(cache-warm, seconds). Don't move on until the gate is green.

Which stages there are, what follows what, and every line of that summary live
in `@acme/quality-gate` (`tooling/quality-gate`) — add or reorder a stage there,
in the table. The root `quality-gate` script is one `pnpm --filter` delegation
into the package and holds no stage of its own.
