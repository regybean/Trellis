# Every package declares a test class so the root test gate is trustworthy

The root `pnpm test` task looks like a repo-wide quality gate, but most
workspace packages ship no `test` script at all. A missing script is
ambiguous: it could mean "this package needs no tests" (a config package) or
"tests are missing" (an untested feature). With no way to tell them apart, a
green `pnpm test` proved only that the _packages that happen to have tests_
pass — not that the repo's coverage intent is satisfied. There was also no
forcing function keeping new packages honest as the monorepo grows.

Two decisions are load-bearing:

1. **Every package declares its test capability as data.** Each `package.json`
   carries an `acme` block with a `testClass` — one of `full-stack`,
   `backend-library`, `frontend-library`, `app`, or `none`. The class is a
   _capability_ statement (does it ship an API router? a UI?), not a directory-
   layer label, so it maps directly onto which canonical test scripts the
   package owes. A standalone checker
   ([`scripts/check-test-policy.mjs`](../../scripts/check-test-policy.mjs),
   wired into `quality-gate` beside `boundaries`) asserts that every
   library-class package exposes its required scripts.

2. **Gaps are tracked, not hidden.** Classifying the 11 currently-untested
   library packages by their true class would turn the gate red immediately —
   punishing honesty. Instead a package may set `testStatus: "todo"` with a
   `reason`: the gate stays green, but the gap is enumerable
   (`pnpm test:policy --todos`) and can never silently regress to "no signal".
   This makes "not needed yet" (`none`/`app`) and "missing" (`todo`) distinct,
   first-class states. Closing a gap means writing the tests, adding the
   scripts, and deleting the `testStatus`/`reason` keys.

The `turbo gen` feature/shared generators emit a compliant `acme` block for new
packages, so the policy is self-perpetuating rather than a one-off cleanup.

## Status

accepted

## Considered and rejected

- **Classify by directory layer (everything under `features/` must test).** The
  trigger for _which_ scripts a package owes is its capability (ships UI →
  needs frontend tests), not its folder. A `features/` package with no UI
  shouldn't be forced to expose `test:frontend`. Layer is already encoded by
  the boundary tags; duplicating it here would drift. Rejected in favour of an
  explicit per-package `testClass`.
- **Mark every untested package its true class with no `todo` escape hatch.**
  Honest, but it turns the gate red on day one for 11 packages, which means the
  policy lands disabled or the gate gets bypassed — defeating the point.
  `testStatus: "todo"` keeps the gate green _and_ the debt visible. Rejected.
- **Infer the class from the file tree instead of declaring it.** A heuristic
  (`has .tsx` → frontend) is exactly the ambiguity we're removing: it can't
  distinguish "intentionally untested" from "forgot to test", and it silently
  reclassifies a package when files move. Declared intent is the contract; the
  file-tree heuristic survives only as a _tripwire_ that warns when a `none`
  package ships UI or a router. Rejected as the primary mechanism.
- **A TypeScript checker run through the repo's tooling.** The check reads
  `package.json` files and asserts script presence — zero domain types, no need
  for the build graph. A plain dependency-free `.mjs` runs instantly in
  `quality-gate` without a compile step. Rejected for simplicity.
