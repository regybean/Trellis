# Dependency-audit gate and suppression policy

**Status:** accepted

The CI `audit` job (`pnpm audit --audit-level=high`) ran with
`continue-on-error: true` — report-only. Report-only rots: 132 advisories
accumulated (3 critical / 67 high) with nothing forcing them down. We make the
audit a real gate (fail on `high`+`critical`, all events) and pair it with a
sanctioned, narrow suppression path so the gate can't be casually disabled when
an unfixable advisory lands.

## Decision

- **Gate at `high`.** Flip the CI `audit` job to `continue-on-error: false`.
  Threshold `high` matches the existing `dependency-review` action and
  `--audit-level=high`, giving one consistent severity line. Moderate/low are
  out of scope — they don't surface at `--audit-level=high`.
- **Same gate locally.** Add an `audit` stage to `scripts/quality-gate.sh` and
  an `"audit"` script, so the gate is caught before PR, not only in CI. The
  stage **graceful-degrades on network failure** (skips with a warning, like
  `gitleaks` when absent) — offline must never block local PR prep. A registry
  that _returns_ advisories still fails; only a transport error (can't reach the
  registry) is a skip. CI, which always has network, is the hard backstop.
- **The gate reads the allowlist-filtered report, not pnpm's exit code.** Both
  the script and the CI job go through `scripts/audit.mjs` rather than calling
  `pnpm audit --audit-level=high` directly. pnpm filters allowlisted advisories
  out of the report but still counts them in the severity summary, and its exit
  code reads that summary — so a single entry in `ignoreGhsas` pins the stage
  red permanently, which is precisely the failure the allowlist exists to
  prevent. The `advisories` map in `pnpm audit --json` _is_ filtered, so the
  wrapper decides from it, prints each blocking advisory with its path, and
  passes transport errors through untouched for the skip above.
- **Fix-first remediation.** Drive high+critical to zero by (a) upgrading deps
  we own directly via the pnpm **catalog** (`pnpm-workspace.yaml` — `next`,
  `vitest`, `drizzle-orm`, and the OpenTelemetry release train), and (b)
  `overrides` in `pnpm-workspace.yaml` for transitive-only advisories whose
  parent hasn't shipped a fix. (pnpm 10 reads `overrides` from
  `pnpm-workspace.yaml`, not `package.json`.) Each override carries an inline
  comment with its GHSA. Overrides are only accepted if `pnpm build` + `pnpm
test` stay green — forcing a version into a deep tree (e.g. `protobufjs` under
  `@grpc/proto-loader`, or a leaf across a major boundary) can break at runtime,
  so:
  - Prefer ranges (`>=x`) over hard pins so parents can still move.
  - A leaf with **multiple in-tree majors** uses a version-range selector
    (`pkg@>=x <y`) with a concrete target, so patching one line can't force an
    incompatible major onto another (`minimatch`, `js-yaml`, `picomatch`).
  - Bound an override to the major its parent peers on when the fix exists there
    (`fast-uri` kept on `3.x` for `ajv@8`'s `^3.0.1`).
  - When an advisory marks _every_ prior version vulnerable **and** the only
    fixed line changed its module shape, forcing it breaks the parent — e.g.
    `brace-expansion`'s `5.0.8` ships a _named_ CJS export that breaks
    `minimatch`'s `require()` default import (surfaces as "expand is not a
    function" across every lint task). Keep the parent-compatible line and
    allowlist the residual until a within-major bump covers it — which is how
    `brace-expansion` eventually resolved: the three within-major floors now
    clear every advisory on it, and its allowlist entry is gone.
- **Allowlist is last resort.** `pnpm.auditConfig.ignoreGhsas` suppresses an
  advisory **only** when (a) no patched version is reachable anywhere in the
  tree, or (b) it's provably not exploitable in our usage (e.g. the `vitest` UI
  server, which we never run in prod/CI). Every entry carries a justification
  comment with GHSA link + date. **No blanket dev-only exemption** — dev-only
  advisories are upgraded/overridden first; being dev-only is not itself grounds
  to ignore. (The standing entries are `image-size`'s two DoS advisories, which
  npm reports as `patched: <0.0.0` — no fixed version exists on any line, so
  neither an override nor a parent bump can reach one.)

## Considered and rejected

- **Keep audit report-only, just clean the baseline.** Rots straight back to red
  within weeks — cleaning without a gate solves nothing durable.
- **Gate at `moderate`.** Diverges from `dependency-review` and buries real
  high/critical signal under moderate/low noise. Revisit once high is stable.
- **Blanket-ignore all dev-only advisories.** Tempting (dev deps don't ship) but
  makes the allowlist a dumping ground and hides genuinely fixable issues. Most
  dev-only ones (vitest, minimatch/@babel under eslint) have patches anyway.
- **Hard-fail the local audit stage offline.** Would block PR prep on a plane /
  flaky registry. CI is the authoritative gate; local is a fast-feedback mirror.

## Consequences

- A future advisory with no reachable patch red-walls every merge until it's
  either overridden or added to `ignoreGhsas` with justification. That friction
  is intentional — it forces a conscious decision rather than silent drift.
- `pnpm.auditConfig.ignoreGhsas` and `overrides` have no native expiry. The list
  is reviewed by hand whenever audit is touched; entries name the GHSA so the
  parent-fixed-it case is easy to spot and remove. No cron, no extra tooling.
- Moderate/low advisories remain invisible at the `high` threshold. Chasing them
  is a separate, later decision.
