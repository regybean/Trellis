# Verification: incremental checks and the gate

How code is verified in this repo. Two tiers — cheap per-package checks while you
work, one full gate at the end. Rationale in [ADR 0020](../adr/0020-commit-tidies-gate-verifies.md).

## As you go — per package

After touching a package, run the cached incremental check (seconds):

```bash
pnpm turbo run lint typecheck -F @acme/<pkg>
```

Don't run the full suite or `quality-gate` per commit.

## At the end — the gate

Run `tidy` (auto-fix) first, then the gate **once**:

```bash
pnpm tidy            # lint:fix + format:fix — mutates the tree
pnpm quality-gate    # read-only verify: turbo(lint+format+typecheck+build+test)
                     # + check:exports + boundaries + lint:ws + deps:lint + test:policy + gitleaks
```

The gate is **read-only** — it verifies, it never fixes. So `tidy` must run first,
or the gate **fails** on fixable lint/format issues. It runs every stage in
parallel and writes `.cache/quality-gate.log` with a per-stage PASS/FAIL summary.
On failure, read that file for the failing stage, fix (or re-`tidy`), and re-run
(cache-warm, seconds). Don't move on until the gate is green.
