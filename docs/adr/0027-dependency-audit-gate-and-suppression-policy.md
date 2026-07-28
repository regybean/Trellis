# Dependency-audit gate and suppression policy

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
  an `"audit": "pnpm audit --audit-level=high"` script, so the gate is caught
  before PR, not only in CI. The stage **graceful-degrades on network failure**
  (skips with a warning, like `gitleaks` when absent) — offline must never block
  local PR prep. CI, which always has network, is the hard backstop.
- **Fix-first remediation.** Drive high+critical to zero by (a) upgrading deps
  we own directly via the pnpm **catalog** (`pnpm-workspace.yaml`), and (b)
  `pnpm.overrides` in root `package.json` for transitive-only advisories whose
  parent hasn't shipped a fix (alongside the existing `glob` override). Each
  override carries an inline comment with its GHSA. Overrides are only accepted
  if `pnpm build` + `pnpm test` stay green — forcing a version into a deep tree
  (e.g. `protobufjs` into grpc under `mastra`) can break at runtime.
- **Allowlist is last resort.** `pnpm.auditConfig.ignoreGhsas` suppresses an
  advisory **only** when (a) no patched version is reachable anywhere in the
  tree, or (b) it's provably not exploitable in our usage (e.g. the `vitest` UI
  server, which we never run in prod/CI). Every entry carries a justification
  comment with GHSA link + date. **No blanket dev-only exemption** — dev-only
  advisories are upgraded/overridden first; being dev-only is not itself grounds
  to ignore.

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

## Status

accepted

## Consequences

- A future advisory with no reachable patch red-walls every merge until it's
  either overridden or added to `ignoreGhsas` with justification. That friction
  is intentional — it forces a conscious decision rather than silent drift.
- `pnpm.auditConfig.ignoreGhsas` and `overrides` have no native expiry. The list
  is reviewed by hand whenever audit is touched; entries name the GHSA so the
  parent-fixed-it case is easy to spot and remove. No cron, no extra tooling.
- Moderate/low advisories remain invisible at the `high` threshold. Chasing them
  is a separate, later decision.
