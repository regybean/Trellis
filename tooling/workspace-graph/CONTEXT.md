# Workspace Graph (`@acme/workspace-graph`)

The one reader of this repo's own workspace. It answers which directories hold
packages, what each package declares, which package a command-line token names,
what a package's closure contains, what that closure needs running and which of
that a given configuration actually starts — plus the CLI convention every repo
checker follows when it reports what it found.

Every repo script used to answer these itself, and the copies drifted: the
workspace directory list alone existed four times with three different contents.
Nothing here knows what any rule is; it hands rules their input.

## Language

**Workspace directory**:
A directory that _directly_ holds packages — `apps`, `packages/shared`,
`tooling`. Derived from the `packages:` globs in `pnpm-workspace.yaml` by
dropping the wildcard segment, never listed by hand.
_Avoid_: "layer" (a layer is a boundary tag in `turbo.json`, and the two sets
only look alike), "workspace root" (that is the repo root)

**Package** (`WorkspacePackage`):
A directory under a workspace directory holding a readable `package.json`,
carrying its absolute `dir`, its repo-relative `rel`, and the parsed `manifest`.
Its `name` is the manifest's, falling back to `rel` when it declares none, so a
message always has something to name. A directory with no manifest is not a
package and is skipped; a manifest that is not valid JSON is an error.
_Avoid_: "module", "workspace" (singular) for one of these

**Project** (`WorkspaceProject`):
A package as `pnpm ls` reports it — a name and a path, nothing read off disk. The
resolver's word for a member of a closure, kept distinct from **package** because
it carries no manifest.
_Avoid_: using it interchangeably with **package**

**Closure**:
The transitive workspace dependency set of one or more named packages,
development dependencies and tooling included. Asked of pnpm against the working
tree, so it is what the checkout's graph says right now.
_Avoid_: "dependency tree", "graph" for this specific set

**Token**:
What a human types to name a package: the full name (`@acme/nextjs`), the
unscoped tail (`nextjs`), or the directory (`nextjs-slim`). A token naming two
packages is refused rather than resolved to one of them.
_Avoid_: "alias", "short name" as a distinct concept — a short name is a token

**Declared infra**:
The union of `acme.infra` over a set of packages. Infra need travels with the
package that owns it, so a deployable's requirement is this union over its
closure and nothing is assumed on. The union is a _candidate_ set — what the
**prune** then reduces.
_Avoid_: "the profile list" (a compose profile is what the caller does with the
answer), "required services"

**Provider selection**:
The authored development values a provisioning decision reads: the Stripe
connection's mode, and which provider each models **role** (`MODELS_CHAT`,
`MODELS_EMBED`) runs on. Passed in as values, never read here — the profiles
live in `platform`, `shared` and `feature` packages, which a `tooling` package
may not depend on.
_Avoid_: "env", "config" (these are authored values, and deliberately not
`process.env`)

**Prune** (`pruneInfra`):
Dropping a candidate profile for a service only needed under a given
configuration — `billing` off real Stripe, `ollama` when no role runs on it. The
rule lives here; the values it decides on come from the caller.
_Avoid_: "filter" (a prune is the named set of rules, not any filtering)

**Compose environment** (`composeEnvironment`):
The record of every value `compose.yaml` interpolates to provision the local
stack, ports parsed back out of the connection URLs that carry them rather than
stored beside them. A value, so `scripts/resolve-compose-env.ts` is what writes
it.
_Avoid_: "the env file" (nothing here writes one; `compose.sh` exports the
rendered lines)

**Violations** (`collectViolations`):
What a checker found, split into errors, which fail the run, and warnings, which
are reported and do not. A checker collects into one of these instead of printing
as it goes, so its output has a single shape.
_Avoid_: "issues", "problems" (the report renders them as problems; the
collection is violations)

**Report** (`formatReport`):
The stdout, stderr and exit code a set of violations produces — a value, so a
checker's output shape can be asserted without running it as a subprocess.
`reportAndExit` writes one and exits.
_Avoid_: "output", "summary" (the summary is the single clean-run line inside a
report)

## Relationships

- **Workspace directory** → **package**: one walk over the workspace directories
  discovers every package, reading each manifest once. Callers that used to walk
  the tree per rule share the one result.
- **Token** → **package**: resolution matches against discovered packages, so a
  token means the same thing to every command that takes one.
- **Package** → **closure** → **declared infra**: the closure query takes full
  names, not tokens, because that is pnpm's own filter vocabulary — resolve the
  token first.
- **Declared infra** + **provider selection** → **prune**: the graph says what a
  closure could need, the authored values say what of it to start. The two shims
  at `scripts/resolve-infra.ts` and `scripts/resolve-compose-env.ts` exist only
  to supply the second half: they may import a runtime package's profile by
  relative path because root scripts carry no boundary tag, and this package may
  not.
- The bank (`tooling/bank/src/lib/bank-closure.mjs`) reads the same workspace file and
  keeps its own copy of that reading. It runs from a bare checkout with nothing
  installed, so it cannot import this package.
- This package is consumed from source and has no build step: nothing builds
  `tooling/*` at install time.

## Decisions

See [`docs/adr/`](../../docs/adr/).
